using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace ExhaustTuner.Core;

/// <summary>
/// Turns the page's messages ({id, action, data}) into dispatcher calls and posts back {id, ok, result|error} plus
/// {id, event, ...} progress messages. "cancel" stops every running request.
/// </summary>
public sealed class MessageRouter
{
    readonly HostDispatcher _dispatcher;
    readonly Action<string> _post;
    CancellationTokenSource _cts = new();

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
            var old = _cts; _cts = new CancellationTokenSource(); old.Cancel();
            return;
        }
        var id = idNode.DeepClone();
        void Send(JsonObject o) { o["id"] = id.DeepClone(); _post(o.ToJsonString()); }
        try
        {
            var result = await _dispatcher.DispatchAsync(action, msg?["data"], ev => Send(ev), _cts.Token);
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
    }
}
