namespace ExhaustTuner.Core;

/// <summary>
/// Wraps the calculator page into the full HTML document the Fusion palette loads. A line-for-line port of
/// web/make_palette.py; the test checks the two give the same bytes.
/// </summary>
public static class PaletteBuilder
{
    const string Early =
        "<script>window.__errs=[];window.addEventListener(\"error\",function(e){window.__errs.push(String(e.message||e)+\" @\"+(e.lineno||\"\")+\":\"+(e.colno||\"\"));});" +
        "window.fusionJavaScriptHandler={handle:function(a,d){return JSON.stringify({early:true,errs:window.__errs,adsk:typeof window.adsk," +
        "send:window.adsk?typeof window.adsk.fusionSendData:\"none\",ua:navigator.userAgent});}};</script>\n";

    public static string Build(string page)
    {
        var i = page.IndexOf("</style>", StringComparison.Ordinal);
        if (i <= 0 || !page.TrimStart().StartsWith("<title>", StringComparison.Ordinal))
            throw new InvalidOperationException("The page does not start with <title> and a <style> block; cannot build the palette.");
        var head = page[..(i + "</style>".Length)];
        var body = page[(i + "</style>".Length)..];
        return "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n" +
               "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n" +
               Early + head + "\n</head>\n<body>" + body.TrimEnd() + "\n</body>\n</html>\n";
    }
}
