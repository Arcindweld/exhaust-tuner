//! PaletteBuilder.cs: the calculator page wrapped in the full HTML document the Fusion palette (and the program's
//! window) loads. A line-for-line port of web/make_palette.py; the test checks the two give the same bytes.

const EARLY: &str = concat!(
    "<script>window.__errs=[];window.addEventListener(\"error\",function(e){window.__errs.push(String(e.message||e)+\" @\"+(e.lineno||\"\")+\":\"+(e.colno||\"\"));});",
    "window.fusionJavaScriptHandler={handle:function(a,d){return JSON.stringify({early:true,errs:window.__errs,adsk:typeof window.adsk,",
    "send:window.adsk?typeof window.adsk.fusionSendData:\"none\",ua:navigator.userAgent});}};</script>\n"
);

pub fn build(page: &str) -> Result<String, String> {
    let i = page.find("</style>");
    let i = match i {
        Some(i) if i > 0 && page.trim_start().starts_with("<title>") => i,
        _ => return Err("The page does not start with <title> and a <style> block; cannot build the palette.".into()),
    };
    let end = i + "</style>".len();
    let (head, body) = (&page[..end], &page[end..]);
    Ok(format!(
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n{}{}\n</head>\n<body>{}\n</body>\n</html>\n",
        EARLY,
        head,
        body.trim_end()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_make_palette_py() {
        // CoreTests.Matches_make_palette_py: the real page through both
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let page = root.join("web/index.html");
        let out = std::env::temp_dir().join(format!("et_palette_{}.html", std::process::id()));
        let run = |py: &str| std::process::Command::new(py).arg(root.join("web/make_palette.py")).arg(&page).arg(&out).status();
        let ok = |st: std::io::Result<std::process::ExitStatus>| matches!(st, Ok(s) if s.success());
        if !ok(run("python3")) && !ok(run("python")) {
            eprintln!("python3 or make_palette.py not available; skipped");
            return;
        }
        let want = std::fs::read_to_string(&out).unwrap();
        let got = build(&std::fs::read_to_string(&page).unwrap()).unwrap();
        assert!(want == got, "palette differs from make_palette.py");
        assert!(build("<p>no title</p>").is_err());
        let _ = std::fs::remove_file(&out);
    }
}
