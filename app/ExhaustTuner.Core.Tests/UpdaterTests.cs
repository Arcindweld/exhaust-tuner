using System.Diagnostics;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using ExhaustTuner.Core;
using Xunit;

namespace ExhaustTuner.Core.Tests;

/// <summary>A stand-in for api.github.com and the storage host it redirects release downloads to.</summary>
sealed class FakeGitHub : HttpMessageHandler
{
    public const string Api = "https://api.example.test", Repo = "owner/repo", Dl = "https://dl.example.test";
    public readonly List<(string Url, string? Auth)> Seen = new();
    public int ListStatus = 200;
    public string ListBody = "[]";
    public byte[] Setup = Encoding.UTF8.GetBytes("pretend installer " + new string('x', 5000));
    public string? Sums;          // null: the right SHA-256 of Setup
    public bool Stall;            // the installer download sends its headers and then nothing
    public string? Expires;       // GitHub-Authentication-Token-Expiration on the release list, like GitHub sends it

    sealed class StallStream : Stream
    {
        public override bool CanRead => true; public override bool CanSeek => false; public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => 0; set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default) { await Task.Delay(Timeout.Infinite, ct); return 0; }
        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken ct) => ReadAsync(buffer.AsMemory(offset, count), ct).AsTask();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }

    public static string Sha(byte[] b) => Convert.ToHexString(SHA256.HashData(b)).ToLowerInvariant();

    /// <summary>One release as GitHub lists it; assets given as (id, name, size).</summary>
    public static JsonObject Release(string tag, bool draft = false, bool pre = false, params (int Id, string Name, long Size)[] assets) => new()
    {
        ["tag_name"] = tag, ["name"] = "Exhaust Tuner " + tag.TrimStart('v'), ["draft"] = draft, ["prerelease"] = pre,
        ["body"] = "- what changed in " + tag, ["published_at"] = "2026-11-01T20:00:00Z", ["html_url"] = "https://github.com/" + Repo + "/releases/tag/" + tag,
        ["assets"] = new JsonArray(assets.Select(a => (JsonNode)new JsonObject
        {
            ["id"] = a.Id, ["name"] = a.Name, ["size"] = a.Size, ["url"] = Api + "/repos/" + Repo + "/releases/assets/" + a.Id,
        }).ToArray()),
    };

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage req, CancellationToken ct)
    {
        var u = req.RequestUri!.ToString();
        lock (Seen) Seen.Add((u, req.Headers.Authorization?.ToString()));
        HttpResponseMessage R(int code, byte[]? body = null, string? location = null)
        {
            var r = new HttpResponseMessage((HttpStatusCode)code) { Content = new ByteArrayContent(body ?? Array.Empty<byte>()) };
            if (location != null) r.Headers.Location = new Uri(location);
            return r;
        }
        if (u == Api + "/repos/" + Repo + "/releases?per_page=20")
        {
            var list = R(ListStatus, Encoding.UTF8.GetBytes(ListBody));
            if (Expires != null) list.Headers.TryAddWithoutValidation("GitHub-Authentication-Token-Expiration", Expires);
            return Task.FromResult(list);
        }
        if (u.StartsWith(Api + "/repos/" + Repo + "/releases/assets/"))
        {
            var id = u[(u.LastIndexOf('/') + 1)..];
            // asset 45 redirects within the API host, the others to the storage host: neither hop may carry the token
            return Task.FromResult(R(302, location: (id == "45" ? Api + "/storage" : Dl) + "/asset/" + id + "?X-Amz-Signature=abc"));
        }
        if (u.StartsWith(Dl + "/asset/") || u.StartsWith(Api + "/storage/asset/"))
        {
            var id = u[(u.IndexOf("/asset/") + "/asset/".Length)..u.IndexOf('?')];
            if (id.EndsWith("9")) return Task.FromResult(R(200, Encoding.UTF8.GetBytes(Sums ?? Sha(Setup) + "  " + SetupName)));
            if (Stall) return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StreamContent(new StallStream()) });
            return Task.FromResult(R(200, Setup));
        }
        return Task.FromResult(R(404));
    }

    public string SetupName = "ExhaustTuner-Setup-0.1.45.exe";

    /// <summary>A list with a draft, a pre-release, a release still missing its checksum file, an older complete
    /// release and the newest complete one (0.1.45; its SHA256SUMS asset id ends in 9).</summary>
    public FakeGitHub Standard()
    {
        ListBody = new JsonArray(
            Release("v0.1.50", draft: true, assets: new[] { (50, "ExhaustTuner-Setup-0.1.50.exe", 10L), (59, "SHA256SUMS.txt", 90L) }),
            Release("v0.1.48", pre: true, assets: new[] { (48, "ExhaustTuner-Setup-0.1.48.exe", 10L), (489, "SHA256SUMS.txt", 90L) }),
            Release("v0.1.47", assets: new[] { (47, "ExhaustTuner-Setup-0.1.47.exe", 10L) }),
            Release("v0.1.45", assets: new[] { (45, SetupName, (long)Setup.Length), (459, "SHA256SUMS.txt", 90L) }),
            Release("v0.1.40", assets: new[] { (40, "ExhaustTuner-Setup-0.1.40.exe", 10L), (409, "SHA256SUMS.txt", 90L) })).ToJsonString();
        return this;
    }
}

public class UpdaterTests
{
    static (AppPaths Paths, string Root) Install(bool installed = true)
    {
        var t = Repo.Temp();
        var app = Path.Combine(t, "app"); Directory.CreateDirectory(app);
        if (installed) File.WriteAllText(Path.Combine(app, "unins000.exe"), "");
        return (new AppPaths(app, Path.Combine(t, "data"), Path.Combine(t, "fusion")), t);
    }

    static Updater Make(AppPaths p, FakeGitHub gh, string version = "0.1.43", List<ProcessStartInfo>? launched = null) =>
        new(p, version, gh, FakeGitHub.Api, FakeGitHub.Repo, psi => launched?.Add(psi));

    const string Token = "github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz";

    [Fact]
    public async Task Without_a_token_it_asks_for_one_and_calls_nobody()
    {
        var (p, _) = Install();
        var gh = new FakeGitHub().Standard();
        var u = Make(p, gh);
        Assert.Equal("not-configured", u.Status()["state"]!.GetValue<string>());
        var s = await u.CheckAsync(true, CancellationToken.None);
        Assert.Equal("not-configured", s["state"]!.GetValue<string>());
        Assert.False(s["configured"]!.GetValue<bool>());
        Assert.Empty(gh.Seen);
    }

    [Fact]
    public async Task Newest_complete_release_is_downloaded_and_verified_and_the_token_stays_on_the_api_host()
    {
        var (p, _) = Install();
        var gh = new FakeGitHub().Standard();
        var u = Make(p, gh);
        Assert.True(u.SetToken(Token)["configured"]!.GetValue<bool>());
        var s = await u.CheckAsync(true, CancellationToken.None);
        Assert.Equal("downloading", s["state"]!.GetValue<string>());
        Assert.Equal("0.1.45", s["latest"]!["version"]!.GetValue<string>());   // not the draft, the pre-release or the one without SHA256SUMS
        await u.WaitAsync();
        s = u.Status();
        Assert.Equal("ready", s["state"]!.GetValue<string>());
        var file = Path.Combine(u.UpdatesDir, gh.SetupName);
        Assert.Equal(gh.Setup, File.ReadAllBytes(file));
        Assert.Equal(FakeGitHub.Sha(gh.Setup), File.ReadAllText(file + ".sha256"));
        Assert.Contains("what changed in v0.1.45", s["latest"]!["notes"]!.GetValue<string>());
        // the token went with every API request and with no redirect, not even one back to the API host
        var stored = gh.Seen.Where(x => x.Url.Contains("/asset/")).ToList();
        Assert.All(gh.Seen.Except(stored), x => Assert.Equal("Bearer " + Token, x.Auth));
        Assert.Equal(2, stored.Count);
        Assert.Contains(stored, x => x.Url.StartsWith(FakeGitHub.Api + "/storage/"));
        Assert.All(stored, x => Assert.Null(x.Auth));
        // the token is never handed back
        Assert.DoesNotContain(Token, s.ToJsonString());
        // a second check finds the verified download and does not fetch it again
        var before = gh.Seen.Count;
        s = await u.CheckAsync(true, CancellationToken.None);
        Assert.Equal("ready", s["state"]!.GetValue<string>());
        Assert.Equal(before + 1, gh.Seen.Count);
    }

    [Fact]
    public async Task Up_to_date_when_nothing_newer_is_published()
    {
        var (p, _) = Install();
        var gh = new FakeGitHub().Standard();
        var u = Make(p, gh, version: "0.1.45");
        u.SetToken(Token);
        var s = await u.CheckAsync(true, CancellationToken.None);
        Assert.Equal("up-to-date", s["state"]!.GetValue<string>());
        Assert.False(s["latest"]!["newer"]!.GetValue<bool>());
        Assert.False(Directory.Exists(u.UpdatesDir) && Directory.EnumerateFiles(u.UpdatesDir).Any());
    }

    [Fact]
    public async Task A_download_that_does_not_match_its_checksum_is_deleted()
    {
        var (p, _) = Install();
        var gh = new FakeGitHub().Standard();
        gh.Sums = new string('0', 64) + "  " + gh.SetupName;
        var u = Make(p, gh);
        u.SetToken(Token);
        await u.CheckAsync(true, CancellationToken.None);
        await u.WaitAsync();
        var s = u.Status();
        Assert.Equal("error", s["state"]!.GetValue<string>());
        Assert.Contains("SHA-256", s["error"]!.GetValue<string>());
        Assert.Empty(Directory.EnumerateFiles(u.UpdatesDir));
    }

    [Fact]
    public async Task A_stalled_download_gives_up_and_the_next_check_starts_it_again()
    {
        var (p, _) = Install();
        var gh = new FakeGitHub { Stall = true }.Standard();
        var u = new Updater(p, "0.1.43", gh, FakeGitHub.Api, FakeGitHub.Repo, _ => { }) { StallSeconds = 1 };
        u.SetToken(Token);
        await u.CheckAsync(true, CancellationToken.None);
        var t = u.WaitAsync();
        Assert.Same(t, await Task.WhenAny(t, Task.Delay(20000)));       // it does not hang
        var s = u.Status();
        Assert.Equal("error", s["state"]!.GetValue<string>());
        Assert.Contains("no data came for 1 s", s["error"]!.GetValue<string>());
        Assert.Empty(Directory.GetFiles(u.UpdatesDir, "*.part"));
        gh.Stall = false;
        await u.CheckAsync(true, CancellationToken.None);
        await u.WaitAsync();
        Assert.Equal("ready", u.Status()["state"]!.GetValue<string>());
    }

    [Theory]
    [InlineData(401, "did not accept the token")]
    [InlineData(404, "Contents: Read-only")]
    [InlineData(500, "HTTP 500")]
    public async Task GitHub_refusals_are_explained(int code, string text)
    {
        var (p, _) = Install();
        var gh = new FakeGitHub { ListStatus = code, ListBody = "{\"message\":\"Bad credentials\"}" };
        var u = Make(p, gh);
        u.SetToken(Token);
        var s = await u.CheckAsync(true, CancellationToken.None);
        Assert.Equal("error", s["state"]!.GetValue<string>());
        Assert.Contains(text, s["error"]!.GetValue<string>());
    }

    [Fact]
    public void Tokens_are_checked_for_shape_and_can_be_removed()
    {
        var (p, _) = Install();
        var u = Make(p, new FakeGitHub());
        var bad = u.SetToken("not a token");
        Assert.False(bad["ok"]!.GetValue<bool>());
        Assert.False(bad["configured"]!.GetValue<bool>());
        Assert.True(u.SetToken("  " + Token + "\n")["configured"]!.GetValue<bool>());
        Assert.Equal(Token, new TokenStore(p.DataRoot).Read());
        var s = u.SetToken("");
        Assert.False(s["configured"]!.GetValue<bool>());
        Assert.Equal("not-configured", s["state"]!.GetValue<string>());
        Assert.False(File.Exists(Path.Combine(p.DataRoot, "update-token.bin")));
    }

    async Task<(Updater U, FakeGitHub Gh, List<ProcessStartInfo> L)> Ready(AppPaths p)
    {
        var gh = new FakeGitHub().Standard();
        var launched = new List<ProcessStartInfo>();
        var u = Make(p, gh, launched: launched);
        u.SetToken(Token);
        await u.CheckAsync(true, CancellationToken.None);
        await u.WaitAsync();
        Assert.Equal("ready", u.Status()["state"]!.GetValue<string>());
        return (u, gh, launched);
    }

    [Fact]
    public async Task Install_starts_the_installer_silently_over_this_install_and_waits_for_the_program()
    {
        var (p, _) = Install();
        var (u, gh, launched) = await Ready(p);
        var r = u.Install(addInInstalled: true, activeRuns: 0);
        Assert.True(r["ok"]!.GetValue<bool>(), r.ToJsonString());
        var psi = Assert.Single(launched);
        Assert.Equal(Path.Combine(u.UpdatesDir, gh.SetupName), psi.FileName);
        foreach (var a in new[] { "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/RELAUNCH=1", "/WAITPID=" + Environment.ProcessId, "/MERGETASKS=addin" })
            Assert.Contains(a, psi.Arguments);
        Assert.Contains(u.PerUserInstall ? "/CURRENTUSER" : "/ALLUSERS", psi.Arguments);
        // without the add-in in Fusion the installer is not asked to put it there
        launched.Clear();
        u.Install(addInInstalled: false, activeRuns: 0);
        Assert.DoesNotContain("/MERGETASKS", Assert.Single(launched).Arguments);
    }

    [Fact]
    public async Task Install_waits_for_runs_refuses_build_folders_and_files_changed_on_disk()
    {
        var (p, _) = Install();
        var (u, gh, launched) = await Ready(p);
        Assert.False(u.Install(false, activeRuns: 1)["ok"]!.GetValue<bool>());
        File.AppendAllText(Path.Combine(u.UpdatesDir, gh.SetupName), "tampered");
        var r = u.Install(false, 0);
        Assert.False(r["ok"]!.GetValue<bool>());
        Assert.Contains("changed on disk", r["msg"]!.GetValue<string>());
        Assert.Empty(launched);

        var (p2, _) = Install(installed: false);
        var (u2, _, launched2) = await Ready(p2);
        var r2 = u2.Install(false, 0);
        Assert.False(r2["ok"]!.GetValue<bool>());
        Assert.Contains("not set up by the installer", r2["msg"]!.GetValue<string>());
        Assert.Empty(launched2);
    }

    [Fact]
    public async Task Dispatcher_closes_the_program_only_when_the_installer_started()
    {
        var (p, _) = Install();
        var (u, _, launched) = await Ready(p);
        var ui = new QuitUi();
        var d = new HostDispatcher(p, ui, u);
        var r = await d.DispatchAsync("updateInstall", null, null, CancellationToken.None);
        Assert.True(r!["ok"]!.GetValue<bool>());
        Assert.Equal(1, ui.Quits);
        Assert.Single(launched);
        Assert.Equal("ready", (await d.DispatchAsync("updateStatus", null, null, CancellationToken.None))!["state"]!.GetValue<string>());
        Assert.Equal("ready", d.Info()["update"]!["state"]!.GetValue<string>());

        var (p2, _) = Install(installed: false);
        var ui2 = new QuitUi();
        var r2 = await new HostDispatcher(p2, ui2, Make(p2, new FakeGitHub())).DispatchAsync("updateInstall", null, null, CancellationToken.None);
        Assert.False(r2!["ok"]!.GetValue<bool>());
        Assert.Equal(0, ui2.Quits);
    }

    sealed class QuitUi : IHostUi
    {
        public int Quits;
        public string? PickFolder(string title) => null;
        public string? PickSaveFile(string title, string suggestedName) => null;
        public void OpenFolder(string path) { }
        public void Quit() => Quits++;
    }

    [Fact]
    public async Task The_token_expiry_GitHub_reports_is_passed_on()
    {
        var (p, _) = Install();
        var when = DateTime.UtcNow.AddDays(10.5);
        var gh = new FakeGitHub { Expires = when.ToString("yyyy-MM-dd HH:mm:ss", System.Globalization.CultureInfo.InvariantCulture) + " UTC" }.Standard();
        var u = Make(p, gh, version: "0.1.45");
        u.SetToken(Token);
        var s = await u.CheckAsync(true, CancellationToken.None);
        Assert.Equal(when.ToString("yyyy-MM-dd"), s["tokenExpires"]!.GetValue<string>());
        Assert.Equal(10, s["tokenDaysLeft"]!.GetValue<int>());
        gh.Expires = null;                       // a token without an expiry date
        s = await u.CheckAsync(true, CancellationToken.None);
        Assert.Null(s["tokenExpires"]);
        Assert.Equal(new DateTimeOffset(2026, 12, 1, 8, 0, 0, TimeSpan.Zero), Updater.ParseExpiry("2026-12-01 08:00:00 UTC"));
        Assert.Equal(new DateTimeOffset(2026, 12, 1, 15, 0, 0, TimeSpan.Zero), Updater.ParseExpiry("2026-12-01 08:00:00 -0700"));
        Assert.Null(Updater.ParseExpiry("soon"));
    }

    [Fact]
    public async Task After_an_update_the_first_start_shows_what_changed()
    {
        var (p, _) = Install();
        var (u, gh, _) = await Ready(p);                                   // downloads 0.1.45 while 0.1.43 runs
        Assert.Null(u.Status()["updated"]);
        Assert.Contains("what changed in v0.1.45", File.ReadAllText(Path.Combine(u.UpdatesDir, gh.SetupName + ".notes.txt")));
        // the installer ran; the next start is 0.1.45 and the start record still says 0.1.43
        var after = new Updater(p, "0.1.45", gh, FakeGitHub.Api, FakeGitHub.Repo, _ => { }, previousVersion: "0.1.43");
        var upd = after.Status()["updated"]!;
        Assert.Equal("0.1.43", upd["from"]!.GetValue<string>());
        Assert.Equal("0.1.45", upd["to"]!.GetValue<string>());
        Assert.Contains("what changed in v0.1.45", upd["notes"]!.GetValue<string>());
        // an ordinary start (same version), or a start after going back to an older version: nothing to show
        Assert.Null(new Updater(p, "0.1.45", gh, FakeGitHub.Api, FakeGitHub.Repo, _ => { }, previousVersion: "0.1.45").Status()["updated"]);
        Assert.Null(new Updater(p, "0.1.43", gh, FakeGitHub.Api, FakeGitHub.Repo, _ => { }, previousVersion: "0.1.45").Status()["updated"]);
    }

    [Fact]
    public void Start_record_returns_the_previous_version()
    {
        var (p, _) = Install();
        Assert.Null(StartRecord.Write(p, "0.1.43"));
        Assert.Equal("0.1.43", StartRecord.Write(p, "0.1.45"));
        var lines = File.ReadAllLines(Path.Combine(p.DataRoot, StartRecord.FileName));
        Assert.Equal("0.1.45", lines[0]);
        Assert.Equal(Environment.ProcessId.ToString(), lines[1]);
        Assert.Equal(4, lines.Length);
    }

    [Fact]
    public void Versions_and_checksum_lines_parse()
    {
        Assert.True(Updater.ParseVersion("v0.1.12") > Updater.ParseVersion("0.1.9"));
        Assert.Equal(new Version(0, 1, 43), Updater.ParseVersion("0.1.43+3f2a1b0"));
        Assert.Null(Updater.ParseVersion("latest"));
        var h = new string('a', 64);
        Assert.Equal(h, Updater.SumFor(new string('b', 64) + "  other.exe\n" + h.ToUpperInvariant() + " *ExhaustTuner-Setup-0.1.45.exe\r\n", "ExhaustTuner-Setup-0.1.45.exe"));
        Assert.Null(Updater.SumFor(h + "  something-else.exe", "ExhaustTuner-Setup-0.1.45.exe"));
    }
}
