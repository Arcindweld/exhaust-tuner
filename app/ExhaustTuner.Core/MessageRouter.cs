using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace ExhaustTuner.Core;

/// <summary>
/// Turns the page's messages ({id, action, data}) into dispatcher calls and posts back {id, ok, result|error} plus
/// {id, event, ...} progress messages. "cancel" with data {id} stops that one request (the bridge's promise .cancel());
/// "cancel" without an id stops every running request.
/// </summary>
public sealed class MessageRouter
{
    readonly HostDispatcher _dispatcher;
    readonly Action<string> _post;
    readonly object _lock = new();
    readonly List<(string Id, CancellationTokenSource Cts)> _running = new();
    // stops for ids that were not running yet (each message is handled on its own task, so a stop sent right after its
    // request can come first), kept for EarlyStop
    readonly List<(string Id, DateTime At)> _early = new();
    static readonly TimeSpan EarlyStop = TimeSpan.FromSeconds(2);

    /// <summary>The request id as a key: "5" for both 5 and "5".</summary>
    static string Key(JsonNode n) => n is JsonValue v && v.TryGetValue<string>(out var s) ? s : n.ToJsonString();

    public MessageRouter(HostDispatcher dispatcher, Action<string> post) { _dispatcher = dispatcher; _post = post; }

    public static string BridgeScript()
    {
        using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("HostBridge.js")
                      ?? throw new InvalidOperationException("HostBridge.js resource missing");
        using var r = new StreamReader(s);
        return r.ReadToEnd().Replace("__VERSION__", HostDispatcher.Version);
    }

    /// <summary>Handles one message (the JSON WebView2 hands over). Returns when the request is finished.</summary>
    public async Task HandleAsync(string json)
    {
        JsonNode? msg;
        try { msg = JsonNode.Parse(json); }
        catch (JsonException) { return; }
        var idNode = msg?["id"];
        var action = msg?["action"]?.GetValue<string>();
        if (idNode is null || action is null) return;
        if (action == "cancel")
        {
            var target = (msg?["data"] as JsonObject)?["id"];
            List<CancellationTokenSource> stop;
            lock (_lock)
            {
                stop = _running.Where(r => target is null || r.Id == Key(target)).Select(r => r.Cts).ToList();
                if (target is not null && stop.Count == 0)
                {
                    _early.RemoveAll(e => DateTime.UtcNow - e.At >= EarlyStop);
                    _early.Add((Key(target), DateTime.UtcNow));
                }
            }
            foreach (var c in stop)   // an id that is not running stops nothing else
                try { c.Cancel(); } catch (ObjectDisposedException) { }   // that request has just finished
            return;
        }
        var id = idNode.DeepClone();
        var entry = (Key(idNode), new CancellationTokenSource());
        lock (_lock)
        {
            _running.Add(entry);
            _early.RemoveAll(e => DateTime.UtcNow - e.At >= EarlyStop);
            var i = _early.FindIndex(e => e.Id == entry.Item1);
            if (i >= 0) { _early.RemoveAt(i); entry.Item2.Cancel(); }
        }
        void Send(JsonObject o) { o["id"] = id.DeepClone(); _post(o.ToJsonString()); }
        try
        {
            var result = await _dispatcher.DispatchAsync(action, msg?["data"], ev => Send(ev), entry.Item2.Token);
            Send(new JsonObject { ["ok"] = true, ["result"] = result });
        }
        catch (OperationCanceledException)
        {
            Send(new JsonObject { ["ok"] = false, ["error"] = "Stopped." });
        }
        catch (Exception e)
        {
            Send(new JsonObject { ["ok"] = false, ["error"] = e.Message });
        }
        finally
        {
            lock (_lock) _running.Remove(entry);
            entry.Item2.Dispose();
        }
    }
}
