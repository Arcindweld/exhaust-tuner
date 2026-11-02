using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace ExhaustTuner.Core;

/// <summary>
/// Updates the program from the GitHub releases its Windows build publishes (.github/workflows/windows.yml, job
/// "release"): every push to the program branch that passes the tests becomes release v0.1.&lt;run number&gt; with the
/// installer and SHA256SUMS.txt, and the notes list the commits since the previous release.
/// The repository is private, so the program needs a GitHub token that can read it (a fine-grained token with
/// Contents: read-only on that one repository). The token is kept encrypted for the Windows user (DPAPI) in the
/// data folder, is never handed back to the page, and is sent only to the GitHub API host: the download host the
/// API redirects to gets a plain request.
/// Check: the newest published release (not a draft or pre-release) that carries both files and a higher version
/// than this program. Download: in the background to updates\ in the data folder; it counts as ready only when its
/// size and SHA-256 match the release. Install: the installer runs silently over this install (same folder and
/// tasks, the Fusion add-in too when it is installed), waits for this program to close, and starts it again.
/// </summary>
public sealed class Updater
{
    public const string DefaultApi = "https://api.github.com";
    public const string DefaultRepo = "Arcindweld/exhaust-tuner";
    public const string SumsName = "SHA256SUMS.txt";
    static readonly Regex SetupRe = new(@"^ExhaustTuner-Setup-(\d+(?:\.\d+){1,3})\.exe$", RegexOptions.IgnoreCase);

    public sealed record Release(Version Version, string Tag, string Name, string Notes, string Published, string HtmlUrl,
                                 string SetupName, string SetupUrl, long SetupSize, string SumsUrl);

    readonly AppPaths _paths;
    readonly Version _current;
    readonly string _currentText, _api, _repo;
    readonly HttpClient _http;
    readonly Action<ProcessStartInfo> _launch;
    readonly TokenStore _tokens;
    readonly object _lock = new();
    readonly SemaphoreSlim _busy = new(1, 1);

    // state, read and written under _lock
    string _state = "idle";        // idle | checking | up-to-date | available | downloading | ready | error
    string? _error, _readyFile, _checked;
    DateTimeOffset? _tokenExpires;    // from GitHub's GitHub-Authentication-Token-Expiration header
    readonly string? _previous;       // the version that ran before this start (StartRecord), when it was older
    Release? _latest;
    long _done, _total;
    Task? _download;

    /// <param name="currentVersion">this program's version (HostDispatcher.Version)</param>
    /// <param name="handler">HTTP handler; it must not follow redirects itself (tests pass a stand-in)</param>
    /// <param name="api">GitHub API base (tests point it at a stand-in server)</param>
    /// <param name="launch">starts the installer (tests record it instead)</param>
    /// <param name="previousVersion">the version the last start recorded (StartRecord); an older one means this start
    /// follows an update, and Status() then carries that update's notes once</param>
    public Updater(AppPaths paths, string currentVersion, HttpMessageHandler? handler = null, string? api = null, string? repo = null,
                   Action<ProcessStartInfo>? launch = null, string? previousVersion = null)
    {
        _paths = paths;
        _currentText = currentVersion;
        _current = ParseVersion(currentVersion) ?? new Version(0, 0, 0);
        _api = (api ?? DefaultApi).TrimEnd('/');
        _repo = repo ?? DefaultRepo;
        _http = new HttpClient(handler ?? new SocketsHttpHandler
        {
            AllowAutoRedirect = false, AutomaticDecompression = DecompressionMethods.All, ConnectTimeout = TimeSpan.FromSeconds(20),
        }) { Timeout = Timeout.InfiniteTimeSpan };
        _launch = launch ?? (psi => Process.Start(psi));
        _tokens = new TokenStore(paths.DataRoot);
        if (!_tokens.Has) _state = "not-configured";
        if (ParseVersion(previousVersion) is { } pv && pv < _current) _previous = previousVersion!.Trim();
    }

    /// <summary>GitHub's token expiry header: "2026-12-01 00:00:00 UTC" (or with a numeric offset).</summary>
    public static DateTimeOffset? ParseExpiry(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        s = s.Trim();
        if (s.EndsWith(" UTC", StringComparison.OrdinalIgnoreCase)) s = s[..^4] + "Z";
        return DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var d)
            ? d : null;
    }

    public string UpdatesDir => Path.Combine(_paths.DataRoot, "updates");

    /// <summary>"v0.1.43" or "0.1.43" -> 0.1.43; null for anything else.</summary>
    public static Version? ParseVersion(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        s = s.Trim();
        if (s.StartsWith('v') || s.StartsWith('V')) s = s[1..];
        var plus = s.IndexOfAny(new[] { '+', '-' });
        if (plus >= 0) s = s[..plus];
        return Version.TryParse(s, out var v) ? v : null;
    }

    /// <summary>This copy was installed by the installer (Inno Setup leaves unins000.exe in the program folder); a copy
    /// run from a build folder cannot update itself.</summary>
    public bool Installed => File.Exists(Path.Combine(_paths.AppRoot, "unins000.exe"));

    /// <summary>Installed for this Windows user only (under %LOCALAPPDATA%), the installer's default.</summary>
    public bool PerUserInstall
    {
        get
        {
            var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            return !string.IsNullOrEmpty(local) &&
                   _paths.AppRoot.StartsWith(Path.GetFullPath(local).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar,
                                             StringComparison.OrdinalIgnoreCase);
        }
    }

    public JsonObject Status()
    {
        lock (_lock)
        {
            var o = new JsonObject
            {
                ["version"] = _currentText, ["configured"] = _tokens.Has, ["state"] = _state, ["error"] = _error,
                ["checked"] = _checked, ["repo"] = _repo, ["installed"] = Installed,
            };
            if (_latest is { } r)
                o["latest"] = new JsonObject
                {
                    ["version"] = r.Version.ToString(), ["tag"] = r.Tag, ["name"] = r.Name, ["notes"] = r.Notes, ["published"] = r.Published,
                    ["url"] = r.HtmlUrl, ["size"] = r.SetupSize, ["newer"] = r.Version > _current,
                };
            if (_state == "downloading") o["progress"] = new JsonObject { ["done"] = _done, ["total"] = _total };
            if (_tokenExpires is { } x)
            {
                o["tokenExpires"] = x.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                o["tokenDaysLeft"] = (int)Math.Floor((x - DateTimeOffset.UtcNow).TotalDays);
            }
            if (_previous is not null)
            {
                // this start follows an update: what changed, as the release said when it was downloaded
                var notes = Path.Combine(UpdatesDir, "ExhaustTuner-Setup-" + _currentText + ".exe.notes.txt");
                string? text = null;
                try { if (File.Exists(notes)) text = File.ReadAllText(notes); } catch (IOException) { }
                o["updated"] = new JsonObject { ["from"] = _previous, ["to"] = _currentText, ["notes"] = text };
            }
            return o;
        }
    }

    void Set(string state, string? error = null) { lock (_lock) { _state = state; _error = error; } }

    /// <summary>Saves the token (an empty one removes it). Not checked against GitHub here: the next check does that.</summary>
    public JsonObject SetToken(string? token)
    {
        token = token?.Trim() ?? "";
        if (token.Length == 0)
        {
            _tokens.Clear();
            lock (_lock) { _state = "not-configured"; _error = null; _latest = null; _tokenExpires = null; }
            return Status();
        }
        if (token.Length < 20 || token.Any(char.IsWhiteSpace) || token.Any(c => c > 126))
        {
            var bad = Status();
            bad["ok"] = false;
            bad["msg"] = "That does not look like a GitHub token (they start with github_pat_ or ghp_).";
            return bad;
        }
        _tokens.Write(token);
        lock (_lock) { _state = "idle"; _error = null; _tokenExpires = null; }
        return Status();
    }

    /// <summary>Looks for a newer release; when there is one and <paramref name="download"/> is set, starts downloading it
    /// in the background and returns at once (Status() then reports the progress).</summary>
    public async Task<JsonObject> CheckAsync(bool download, CancellationToken ct)
    {
        var token = _tokens.Read();
        if (token is null) { Set("not-configured"); return Status(); }
        if (!await _busy.WaitAsync(0, ct)) return Status();        // a check or a download is already running
        var started = false;
        try
        {
            Set("checking");
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(45));
            var rel = await LatestAsync(token, cts.Token);
            lock (_lock) { _latest = rel; _checked = DateTime.UtcNow.ToString("o"); }
            if (rel is null || rel.Version <= _current) { Set("up-to-date"); return Status(); }
            var ready = ReadyFile(rel);
            if (ready is not null) { lock (_lock) { _readyFile = ready; } Set("ready"); return Status(); }
            if (!download) { Set("available"); return Status(); }
            lock (_lock) { _done = 0; _total = rel.SetupSize; }
            Set("downloading");
            started = true;
            // not tied to the request: the page's Stop (which cancels every running request) must not end a download
            _download = Task.Run(async () =>
            {
                try
                {
                    var file = await DownloadAsync(token, rel);
                    lock (_lock) { _readyFile = file; }
                    Set("ready");
                }
                catch (OperationCanceledException)
                {
                    DropPartial();
                    Set("error", "The download stopped: no data came for " + StallSeconds + " s (or it ran past 30 min). The next check tries again.");
                }
                catch (Exception e) { DropPartial(); Set("error", Message(e)); }
                finally { _busy.Release(); }
            });
            return Status();
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested) { Set("error", "GitHub did not answer within 45 s."); return Status(); }
        catch (OperationCanceledException) { Set("idle"); throw; }                 // the page stopped the request
        catch (Exception e) { Set("error", Message(e)); return Status(); }
        finally { if (!started) _busy.Release(); }
    }

    void DropPartial()
    {
        try { foreach (var f in Directory.GetFiles(UpdatesDir, "*.part")) File.Delete(f); }
        catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    /// <summary>Waits for a background download (tests).</summary>
    public Task WaitAsync() => _download ?? Task.CompletedTask;

    static string Message(Exception e) => e switch
    {
        UpdateException u => u.Message,
        HttpRequestException h => "Could not reach GitHub (" + h.Message + ").",
        IOException io => "The download failed (" + io.Message + "). The next check tries again.",
        _ => e.Message,
    };

    sealed class UpdateException : Exception { public UpdateException(string m) : base(m) { } }

    /// <summary>GET with redirects followed by hand: the token goes only with the first request, and only to the API
    /// host; a redirect never carries it, whatever host it names (GitHub sends release downloads to a signed storage
    /// URL that must not get it).</summary>
    async Task<HttpResponseMessage> SendAsync(string url, string token, string accept, CancellationToken ct)
    {
        for (var hop = 0; ; hop++)
        {
            var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.UserAgent.ParseAdd("ExhaustTuner/" + _currentText);
            req.Headers.Accept.ParseAdd(accept);
            if (hop == 0 && url.StartsWith(_api + "/", StringComparison.OrdinalIgnoreCase))
            {
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                req.Headers.Add("X-GitHub-Api-Version", "2022-11-28");
            }
            var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
            var code = (int)resp.StatusCode;
            if (code is 301 or 302 or 303 or 307 or 308 && resp.Headers.Location is { } loc)
            {
                resp.Dispose();
                if (hop >= 5) throw new UpdateException("Too many redirects from GitHub.");
                var next = loc.IsAbsoluteUri ? loc : new Uri(new Uri(url), loc);
                if (next.Scheme != Uri.UriSchemeHttps && !url.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
                    throw new UpdateException("GitHub redirected the download to a plain http address; not followed.");
                url = next.ToString();
                continue;
            }
            return resp;
        }
    }

    static string ApiMessage(string body)
    {
        try { return JsonNode.Parse(body)?["message"]?.GetValue<string>() ?? ""; } catch (JsonException) { return ""; }
    }

    async Task<Release?> LatestAsync(string token, CancellationToken ct)
    {
        using var resp = await SendAsync(_api + "/repos/" + _repo + "/releases?per_page=20", token, "application/vnd.github+json", ct);
        var body = await resp.Content.ReadAsStringAsync(ct);
        var code = (int)resp.StatusCode;
        if (code == 200 && resp.Headers.TryGetValues("GitHub-Authentication-Token-Expiration", out var exp))
            lock (_lock) { _tokenExpires = ParseExpiry(exp.FirstOrDefault()); }
        else if (code == 200)
            lock (_lock) { _tokenExpires = null; }          // a token without an expiry date
        if (code == 401) throw new UpdateException("GitHub did not accept the token (expired or revoked?). Make a new one and save it here.");
        if (code == 404) throw new UpdateException("GitHub does not show " + _repo + " to this token. A fine-grained token needs " + _repo +
                                                   " under Repository access and Contents: Read-only under Permissions.");
        if (code == 403) throw new UpdateException("GitHub refused the request: " + ApiMessage(body));
        if (code != 200) throw new UpdateException("GitHub answered HTTP " + code + (ApiMessage(body) is { Length: > 0 } m ? ": " + m : "."));
        if (JsonNode.Parse(body) is not JsonArray list) throw new UpdateException("GitHub's release list was not readable.");
        Release? best = null;
        foreach (var r in list)
        {
            if (r is null || r["draft"]?.GetValue<bool>() == true || r["prerelease"]?.GetValue<bool>() == true) continue;
            var tag = r["tag_name"]?.GetValue<string>() ?? "";
            var v = ParseVersion(tag);
            if (v is null) continue;
            string? setupName = null, setupUrl = null, sumsUrl = null; long size = 0;
            foreach (var a in r["assets"] as JsonArray ?? new JsonArray())
            {
                var name = a?["name"]?.GetValue<string>() ?? "";
                var url = a?["url"]?.GetValue<string>() ?? "";
                if (name.Equals(SumsName, StringComparison.OrdinalIgnoreCase)) sumsUrl = url;
                else if (SetupRe.Match(name) is { Success: true } m && ParseVersion(m.Groups[1].Value) == v)
                { setupName = name; setupUrl = url; size = a?["size"]?.GetValue<long>() ?? 0; }
            }
            if (setupName is null || setupUrl is null || sumsUrl is null) continue;      // still uploading, or not a program release
            if (best is null || v > best.Version)
                best = new Release(v, tag, r["name"]?.GetValue<string>() ?? tag, r["body"]?.GetValue<string>() ?? "",
                                   r["published_at"]?.GetValue<string>() ?? "", r["html_url"]?.GetValue<string>() ?? "",
                                   setupName, setupUrl, size, sumsUrl);
        }
        return best;
    }

    /// <summary>The SHA-256 SHA256SUMS.txt gives for one file ("hash  name" or "hash *name" lines).</summary>
    public static string? SumFor(string sums, string name)
    {
        foreach (var raw in sums.Split('\n'))
        {
            var line = raw.Trim();
            var m = Regex.Match(line, @"^([0-9a-fA-F]{64})\s+\*?(.+)$");
            if (m.Success && m.Groups[2].Value.Trim().Equals(name, StringComparison.OrdinalIgnoreCase)) return m.Groups[1].Value.ToLowerInvariant();
        }
        return null;
    }

    static string Sha256(string file)
    {
        using var s = File.OpenRead(file);
        return Convert.ToHexString(SHA256.HashData(s)).ToLowerInvariant();
    }

    /// <summary>An installer for this release downloaded and verified earlier (it is checked again here).</summary>
    string? ReadyFile(Release rel)
    {
        var f = Path.Combine(UpdatesDir, rel.SetupName);
        var h = f + ".sha256";
        if (!File.Exists(f) || !File.Exists(h)) return null;
        if (rel.SetupSize > 0 && new FileInfo(f).Length != rel.SetupSize) return null;
        return Sha256(f) == File.ReadAllText(h).Trim() ? f : null;
    }

    /// <summary>A download is given up when no data comes for this long (the next check starts it again).</summary>
    public int StallSeconds { get; init; } = 60;

    async Task<string> DownloadAsync(string token, Release rel)
    {
        // no data for StallSeconds, or 30 minutes in all, ends the download: a stalled connection must not keep the
        // updater busy (and later checks waiting) for good
        using var all = new CancellationTokenSource(TimeSpan.FromMinutes(30));
        using var stall = CancellationTokenSource.CreateLinkedTokenSource(all.Token);
        var ct = stall.Token;
        void Alive() => stall.CancelAfter(TimeSpan.FromSeconds(StallSeconds));
        Alive();
        Directory.CreateDirectory(UpdatesDir);
        string sums;
        using (var r = await SendAsync(rel.SumsUrl, token, "application/octet-stream", ct))
        {
            if (!r.IsSuccessStatusCode) throw new UpdateException("Downloading " + SumsName + " failed (HTTP " + (int)r.StatusCode + ").");
            sums = await r.Content.ReadAsStringAsync(ct);
        }
        Alive();
        var expected = SumFor(sums, rel.SetupName) ?? throw new UpdateException(SumsName + " in " + rel.Tag + " has no line for " + rel.SetupName + ".");
        var part = Path.Combine(UpdatesDir, rel.SetupName + ".part");
        string got; long done = 0;
        using (var r = await SendAsync(rel.SetupUrl, token, "application/octet-stream", ct))
        {
            if (!r.IsSuccessStatusCode) throw new UpdateException("Downloading the installer failed (HTTP " + (int)r.StatusCode + ").");
            var total = r.Content.Headers.ContentLength ?? rel.SetupSize;
            lock (_lock) { _total = total; }
            using var src = await r.Content.ReadAsStreamAsync(ct);
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            await using (var dst = new FileStream(part, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 16, useAsync: true))
            {
                var buf = new byte[1 << 16];
                int n;
                while ((n = await src.ReadAsync(buf, ct)) > 0)
                {
                    Alive();
                    await dst.WriteAsync(buf.AsMemory(0, n), ct);
                    hash.AppendData(buf, 0, n);
                    done += n;
                    lock (_lock) { _done = done; }
                }
            }
            got = Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
        }
        if (rel.SetupSize > 0 && done != rel.SetupSize)
        {
            File.Delete(part);
            throw new UpdateException("The download stopped early (" + done + " of " + rel.SetupSize + " bytes). The next check tries again.");
        }
        if (got != expected)
        {
            File.Delete(part);
            throw new UpdateException("The downloaded installer does not match the SHA-256 published with " + rel.Tag + "; it was deleted.");
        }
        var final = Path.Combine(UpdatesDir, rel.SetupName);
        File.Move(part, final, overwrite: true);
        File.WriteAllText(final + ".sha256", got);
        File.WriteAllText(final + ".notes.txt", rel.Notes);         // shown once after the update (Status "updated")
        foreach (var old in Directory.GetFiles(UpdatesDir, "ExhaustTuner-Setup-*"))          // older installers, checksums, notes
            if (!old.StartsWith(final, StringComparison.OrdinalIgnoreCase))
                try { File.Delete(old); } catch (IOException) { }
        return final;
    }

    /// <summary>Starts the downloaded installer for a silent update over this install. The caller closes the program
    /// when ok is true (the installer waits for that, then starts the program again).</summary>
    public JsonObject Install(bool addInInstalled, int activeRuns)
    {
        string? file; Release? rel; string state;
        lock (_lock) { file = _readyFile; rel = _latest; state = _state; }
        JsonObject Fail(string m) => new() { ["ok"] = false, ["msg"] = m };
        if (state != "ready" || file is null || rel is null || !File.Exists(file)) return Fail("No update is downloaded yet.");
        if (!Installed)
            return Fail("This copy of the program was not set up by the installer (no unins000.exe in " + _paths.AppRoot +
                        "), so it cannot update itself. Install " + rel.SetupName + " from " + rel.HtmlUrl + " instead.");
        if (activeRuns > 0) return Fail("A run is still going. Install the update when it has finished.");
        var h = file + ".sha256";
        if (!File.Exists(h) || Sha256(file) != File.ReadAllText(h).Trim())
        {
            Set("available");
            return Fail("The downloaded installer changed on disk since it was checked, so it was not started. Check again to download it anew.");
        }
        var log = Path.Combine(UpdatesDir, "install-" + rel.Version + ".log");
        var args = new List<string>
        {
            "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS",
            PerUserInstall ? "/CURRENTUSER" : "/ALLUSERS",           // the same install mode as now (all users asks Windows for permission)
            "/RELAUNCH=1", "/WAITPID=" + Environment.ProcessId, "/LOG=\"" + log + "\"",
        };
        if (addInInstalled) args.Add("/MERGETASKS=addin");           // updates the add-in in Fusion as well
        var psi = new ProcessStartInfo(file, string.Join(" ", args)) { UseShellExecute = false, WorkingDirectory = UpdatesDir };
        _launch(psi);
        return new JsonObject
        {
            ["ok"] = true, ["version"] = rel.Version.ToString(), ["args"] = psi.Arguments,
            ["msg"] = "Installing " + rel.Version + ". The program closes now and opens again when the update is in (about a minute).",
        };
    }
}

/// <summary>The GitHub token, encrypted for the current Windows user (DPAPI). On other systems (the tests) it is a
/// file only the user can read.</summary>
public sealed class TokenStore
{
    static readonly byte[] Entropy = Encoding.UTF8.GetBytes("ExhaustTuner update token v1");
    readonly string _file;
    public TokenStore(string dataRoot) { _file = Path.Combine(dataRoot, "update-token.bin"); }
    public bool Has => File.Exists(_file);

    public string? Read()
    {
        if (!File.Exists(_file)) return null;
        try
        {
            var b = File.ReadAllBytes(_file);
            if (OperatingSystem.IsWindows()) b = ProtectedData.Unprotect(b, Entropy, DataProtectionScope.CurrentUser);
            var s = Encoding.UTF8.GetString(b).Trim();
            return s.Length > 0 ? s : null;
        }
        catch (CryptographicException) { return null; }          // written by another Windows user or machine
    }

    public void Write(string token)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_file)!);
        var b = Encoding.UTF8.GetBytes(token);
        if (OperatingSystem.IsWindows()) b = ProtectedData.Protect(b, Entropy, DataProtectionScope.CurrentUser);
        File.WriteAllBytes(_file, b);
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(_file, UnixFileMode.UserRead | UnixFileMode.UserWrite);
    }

    public void Clear() { if (File.Exists(_file)) File.Delete(_file); }
}
