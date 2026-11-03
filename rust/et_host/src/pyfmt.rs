//! Python's number formatting and its JSON writer, for files that must come out byte for byte as the case's Python
//! scripts write them (results.json, results.txt): repr() of a float, %-formatting (%f %e %g %d %s), json.dump with
//! indent=2, and sum() of floats as Python 3.12 and later add them (Neumaier's compensated sum).

/// A Python value as json.dump sees it: ints and floats stay apart (1 and 1.0 print differently), floats may be NaN.
#[derive(Clone, Debug, PartialEq, Default)]
pub enum Py {
    #[default]
    None,
    Bool(bool),
    Int(i64),
    Float(f64),
    Str(String),
    List(Vec<Py>),
    Dict(Dict),
}

/// An insertion-ordered dict; setting an existing key keeps its place, as Python's dict does.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Dict(pub Vec<(String, Py)>);
impl Dict {
    pub fn new() -> Dict {
        Dict(Vec::new())
    }
    pub fn set(&mut self, k: &str, v: Py) {
        if let Some(e) = self.0.iter_mut().find(|e| e.0 == k) {
            e.1 = v;
        } else {
            self.0.push((k.to_string(), v));
        }
    }
    pub fn get(&self, k: &str) -> Option<&Py> {
        self.0.iter().find(|e| e.0 == k).map(|e| &e.1)
    }
    pub fn get_mut(&mut self, k: &str) -> Option<&mut Py> {
        self.0.iter_mut().find(|e| e.0 == k).map(|e| &mut e.1)
    }
    pub fn contains(&self, k: &str) -> bool {
        self.get(k).is_some()
    }
}

impl Py {
    /// From JSON as json.load reads it (a number with a fraction or exponent is a float, else an int).
    pub fn from_json(v: &serde_json::Value) -> Py {
        use serde_json::Value as V;
        match v {
            V::Null => Py::None,
            V::Bool(b) => Py::Bool(*b),
            V::Number(n) => match n.as_i64() {
                Some(i) if !n.is_f64() => Py::Int(i),
                _ => Py::Float(n.as_f64().unwrap_or(f64::NAN)),
            },
            V::String(s) => Py::Str(s.clone()),
            V::Array(a) => Py::List(a.iter().map(Py::from_json).collect()),
            V::Object(o) => Py::Dict(Dict(o.iter().map(|(k, v)| (k.clone(), Py::from_json(v))).collect())),
        }
    }
    /// To serde_json for the program's reply; NaN and the infinities become null (JSON has no word for them).
    pub fn to_json(&self) -> serde_json::Value {
        use serde_json::Value as V;
        match self {
            Py::None => V::Null,
            Py::Bool(b) => V::Bool(*b),
            Py::Int(i) => V::from(*i),
            Py::Float(f) => serde_json::Number::from_f64(*f).map(V::Number).unwrap_or(V::Null),
            Py::Str(s) => V::String(s.clone()),
            Py::List(a) => V::Array(a.iter().map(|x| x.to_json()).collect()),
            Py::Dict(d) => V::Object(d.0.iter().map(|(k, v)| (k.clone(), v.to_json())).collect()),
        }
    }
    /// The value as a float, as Python's arithmetic would use it (ints convert, bools are 0 and 1).
    pub fn f(&self) -> Option<f64> {
        match self {
            Py::Int(i) => Some(*i as f64),
            Py::Float(f) => Some(*f),
            Py::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
            _ => None,
        }
    }
    /// Python truthiness.
    pub fn truthy(&self) -> bool {
        match self {
            Py::None => false,
            Py::Bool(b) => *b,
            Py::Int(i) => *i != 0,
            Py::Float(f) => *f != 0.0,
            Py::Str(s) => !s.is_empty(),
            Py::List(a) => !a.is_empty(),
            Py::Dict(d) => !d.0.is_empty(),
        }
    }
    /// str() of the value, as %s prints it.
    pub fn str(&self) -> String {
        match self {
            Py::None => "None".into(),
            Py::Bool(b) => (if *b { "True" } else { "False" }).into(),
            Py::Int(i) => i.to_string(),
            Py::Float(f) => repr(*f),
            Py::Str(s) => s.clone(),
            other => dumps(other, None),
        }
    }
}

/// The shortest digits that read back as x, and the decimal exponent: x = 0.d1d2d3... * 10^decpt.
fn shortest(x: f64) -> (String, i32) {
    let s = format!("{:e}", x.abs()); // e.g. "1.2345e-7", the shortest round-trip digits
    let (m, e) = s.split_once('e').unwrap();
    let digits: String = m.chars().filter(|c| *c != '.').collect();
    let digits = digits.trim_end_matches('0').to_string();
    let digits = if digits.is_empty() { "0".to_string() } else { digits };
    (digits, e.parse::<i32>().unwrap() + 1)
}

/// repr(float).
pub fn repr(x: f64) -> String {
    if x.is_nan() {
        return "nan".into();
    }
    if x.is_infinite() {
        return (if x > 0.0 { "inf" } else { "-inf" }).into();
    }
    let sign = if x.is_sign_negative() { "-" } else { "" };
    if x == 0.0 {
        return format!("{}0.0", sign);
    }
    let (d, decpt) = shortest(x);
    let n = d.len() as i32;
    let body = if decpt <= -4 || decpt > 16 {
        let mant = if n == 1 { d.clone() } else { format!("{}.{}", &d[..1], &d[1..]) };
        let e = decpt - 1;
        format!("{}e{}{:02}", mant, if e < 0 { '-' } else { '+' }, e.abs())
    } else if decpt <= 0 {
        format!("0.{}{}", "0".repeat((-decpt) as usize), d)
    } else if decpt >= n {
        format!("{}{}.0", d, "0".repeat((decpt - n) as usize))
    } else {
        format!("{}.{}", &d[..decpt as usize], &d[decpt as usize..])
    };
    format!("{}{}", sign, body)
}

fn nonfinite(x: f64) -> Option<String> {
    if x.is_nan() {
        Some("nan".into())
    } else if x.is_infinite() {
        Some((if x > 0.0 { "inf" } else { "-inf" }).into())
    } else {
        None
    }
}

/// "%.{p}f" (Rust's fixed formatting rounds the exact binary value half to even, as C's printf does).
pub fn fix(x: f64, p: usize) -> String {
    nonfinite(x).unwrap_or_else(|| format!("{:.*}", p, x))
}
/// "%.{p}e": at least two exponent digits and a sign, as C writes them.
pub fn exp(x: f64, p: usize) -> String {
    if let Some(s) = nonfinite(x) {
        return s;
    }
    let s = format!("{:.*e}", p, x);
    let (m, e) = s.split_once('e').unwrap();
    let e: i32 = e.parse().unwrap();
    format!("{}e{}{:02}", m, if e < 0 { '-' } else { '+' }, e.abs())
}
/// "%.{p}g" (no '#' flag: trailing zeros and a bare point go).
pub fn gen(x: f64, p: usize) -> String {
    if let Some(s) = nonfinite(x) {
        return s;
    }
    let p = p.max(1);
    if x == 0.0 {
        return (if x.is_sign_negative() { "-0" } else { "0" }).into();
    }
    let e_form = format!("{:.*e}", p - 1, x);
    let xexp: i32 = e_form.split_once('e').unwrap().1.parse().unwrap();
    let strip = |s: String| -> String {
        if s.contains('.') {
            s.trim_end_matches('0').trim_end_matches('.').to_string()
        } else {
            s
        }
    };
    if xexp >= -4 && xexp < p as i32 {
        strip(format!("{:.*}", (p as i32 - 1 - xexp) as usize, x))
    } else {
        let (m, _) = e_form.split_once('e').unwrap();
        format!("{}e{}{:02}", strip(m.to_string()), if xexp < 0 { '-' } else { '+' }, xexp.abs())
    }
}
/// "%d" of a float: int() of it (towards zero); None for NaN and the infinities, where Python raises.
pub fn int_of(x: f64) -> Option<i64> {
    if x.is_finite() {
        Some(x.trunc() as i64)
    } else {
        None
    }
}
/// Right-aligned in a field of w characters (%{w}s, %{w}.{p}f ...).
pub fn rj(s: &str, w: usize) -> String {
    format!("{:>w$}", s, w = w)
}
/// Left-aligned in a field of w characters (%-{w}s).
pub fn lj(s: &str, w: usize) -> String {
    format!("{:<w$}", s, w = w)
}

/// json.dumps(v, indent=indent) with Python's defaults (ensure_ascii, allow_nan: NaN, Infinity, -Infinity).
pub fn dumps(v: &Py, indent: Option<usize>) -> String {
    let mut out = String::new();
    write(&mut out, v, indent, 0);
    out
}
fn write(out: &mut String, v: &Py, indent: Option<usize>, level: usize) {
    match v {
        Py::None => out.push_str("null"),
        Py::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Py::Int(i) => out.push_str(&i.to_string()),
        Py::Float(f) => out.push_str(&if f.is_nan() {
            "NaN".to_string()
        } else if f.is_infinite() {
            (if *f > 0.0 { "Infinity" } else { "-Infinity" }).to_string()
        } else {
            repr(*f)
        }),
        Py::Str(s) => quote(out, s),
        Py::List(a) => {
            if a.is_empty() {
                out.push_str("[]");
                return;
            }
            out.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                    if indent.is_none() {
                        out.push(' ');
                    }
                }
                newline(out, indent, level + 1);
                write(out, x, indent, level + 1);
            }
            newline(out, indent, level);
            out.push(']');
        }
        Py::Dict(d) => {
            if d.0.is_empty() {
                out.push_str("{}");
                return;
            }
            out.push('{');
            for (i, (k, x)) in d.0.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                    if indent.is_none() {
                        out.push(' ');
                    }
                }
                newline(out, indent, level + 1);
                quote(out, k);
                out.push_str(": ");
                write(out, x, indent, level + 1);
            }
            newline(out, indent, level);
            out.push('}');
        }
    }
}
fn newline(out: &mut String, indent: Option<usize>, level: usize) {
    if let Some(n) = indent {
        out.push('\n');
        out.push_str(&" ".repeat(n * level));
    }
}
fn quote(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 || (c as u32) > 0x7e => {
                let mut b = [0u16; 2];
                for u in c.encode_utf16(&mut b) {
                    out.push_str(&format!("\\u{:04x}", u));
                }
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

/// sum() of floats as Python 3.12 and later add them: Neumaier's compensated sum, the compensation added at the end
/// only when it is finite and not zero.
pub fn psum<I: IntoIterator<Item = f64>>(it: I) -> f64 {
    let (mut s, mut c) = (0.0f64, 0.0f64);
    for x in it {
        let t = s + x;
        if s.abs() >= x.abs() {
            c += (s - t) + x;
        } else {
            c += (x - t) + s;
        }
        s = t;
    }
    if c != 0.0 && c.is_finite() {
        s += c;
    }
    s
}
/// Python's min(a, b) and max(a, b): the first argument unless the second is strictly smaller (larger).
pub fn pmin(a: f64, b: f64) -> f64 {
    if b < a {
        b
    } else {
        a
    }
}
pub fn pmax(a: f64, b: f64) -> f64 {
    if b > a {
        b
    } else {
        a
    }
}
/// What a text-mode file written by Python holds on this OS: \n becomes \r\n on Windows.
pub fn text_mode(s: &str) -> String {
    if cfg!(windows) {
        s.replace('\n', "\r\n")
    } else {
        s.to_string()
    }
}
/// What a text-mode read in Python sees: \r\n and a lone \r become \n.
pub fn universal_newlines(s: &str) -> String {
    s.replace("\r\n", "\n").replace('\r', "\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn like_python() {
        let r: Vec<String> = [0.1, 1e-5, 1.5e-7, 1e16, 1e15, 123456.5, 2.0, -0.0, 0.0001, 1.0 / 3.0, 5e-324, 1.7976931348623157e308]
            .iter()
            .map(|&x| repr(x))
            .collect();
        assert_eq!(
            r,
            ["0.1", "1e-05", "1.5e-07", "1e+16", "1000000000000000.0", "123456.5", "2.0", "-0.0", "0.0001", "0.3333333333333333", "5e-324", "1.7976931348623157e+308"]
        );
        assert_eq!(exp(1.234e-5, 2), "1.23e-05");
        assert_eq!(gen(1.234e-5, 6), "1.234e-05");
        assert_eq!(gen(0.0300234, 6), "0.0300234");
        assert_eq!(gen(123456.7, 6), "123457");
        assert_eq!(gen(1234567.0, 6), "1.23457e+06");
        assert_eq!(gen(0.0075, 2), "0.0075");
        assert_eq!(gen(0.012345, 2), "0.012");
        assert_eq!(fix(f64::NAN, 4), "nan");
        assert_eq!(fix(0.125, 2), "0.12");
        let mut d = Dict::new();
        d.set("a", Py::List(vec![]));
        d.set("b", Py::Dict(Dict::new()));
        d.set("c", Py::Float(f64::NAN));
        d.set("é", Py::Int(3));
        assert_eq!(dumps(&Py::Dict(d), Some(2)), "{\n  \"a\": [],\n  \"b\": {},\n  \"c\": NaN,\n  \"\\u00e9\": 3\n}");
        assert_eq!(psum([0.1, 0.2, 0.3]), 0.6); // plain adding gives 0.6000000000000001
    }
}

/// One argument of Python's % operator.
#[derive(Clone, Debug)]
pub enum A {
    S(String),
    I(i64),
    F(f64),
}
impl From<&str> for A {
    fn from(s: &str) -> A {
        A::S(s.to_string())
    }
}
impl From<String> for A {
    fn from(s: String) -> A {
        A::S(s)
    }
}
impl From<&String> for A {
    fn from(s: &String) -> A {
        A::S(s.clone())
    }
}
impl From<f64> for A {
    fn from(x: f64) -> A {
        A::F(x)
    }
}
impl From<i64> for A {
    fn from(x: i64) -> A {
        A::I(x)
    }
}
impl From<usize> for A {
    fn from(x: usize) -> A {
        A::I(x as i64)
    }
}
impl From<i32> for A {
    fn from(x: i32) -> A {
        A::I(x as i64)
    }
}

/// fmt % args, as Python's printf-style formatting does it: %s %d %i %f %e %g %r %%, with flags - + 0 and space,
/// a width and a precision; %(name)x takes the named argument instead. Panics on a format the templates do not use
/// (a mismatch is a programming error, caught by the byte-for-byte tests).
pub fn pct(fmt: &str, args: &[A]) -> String {
    pct_impl(fmt, args, &[])
}
pub fn pct_named(fmt: &str, named: &[(&str, A)]) -> String {
    pct_impl(fmt, &[], named)
}
fn pct_impl(fmt: &str, args: &[A], named: &[(&str, A)]) -> String {
    let c: Vec<char> = fmt.chars().collect();
    let mut out = String::new();
    let (mut i, mut k) = (0usize, 0usize);
    while i < c.len() {
        if c[i] != '%' {
            out.push(c[i]);
            i += 1;
            continue;
        }
        i += 1;
        let mut arg: Option<A> = None;
        if c[i] == '(' {
            let j = (i..c.len()).find(|&j| c[j] == ')').expect("%(name");
            let name: String = c[i + 1..j].iter().collect();
            arg = Some(named.iter().find(|e| e.0 == name).unwrap_or_else(|| panic!("no %({}) argument", name)).1.clone());
            i = j + 1;
        }
        let (mut left, mut zero, mut plus, mut space) = (false, false, false, false);
        while i < c.len() && "-0+ #".contains(c[i]) {
            match c[i] {
                '-' => left = true,
                '0' => zero = true,
                '+' => plus = true,
                ' ' => space = true,
                _ => {}
            }
            i += 1;
        }
        let mut width = 0usize;
        while i < c.len() && c[i].is_ascii_digit() {
            width = width * 10 + c[i].to_digit(10).unwrap() as usize;
            i += 1;
        }
        let mut prec: Option<usize> = None;
        if i < c.len() && c[i] == '.' {
            i += 1;
            let mut p = 0usize;
            while i < c.len() && c[i].is_ascii_digit() {
                p = p * 10 + c[i].to_digit(10).unwrap() as usize;
                i += 1;
            }
            prec = Some(p);
        }
        let conv = c[i];
        i += 1;
        if conv == '%' {
            out.push('%');
            continue;
        }
        let a = match arg {
            Some(a) => a,
            None => {
                let a = args.get(k).unwrap_or_else(|| panic!("not enough arguments for format string {:?}", fmt)).clone();
                k += 1;
                a
            }
        };
        let num = |a: &A| match a {
            A::F(x) => *x,
            A::I(n) => *n as f64,
            A::S(s) => panic!("a number is required, not str {:?}", s),
        };
        let mut s = match conv {
            's' | 'r' => match &a {
                A::S(s) => {
                    if conv == 'r' {
                        format!("'{}'", s)
                    } else {
                        s.clone()
                    }
                }
                A::I(n) => n.to_string(),
                A::F(x) => repr(*x),
            },
            'd' | 'i' => match &a {
                A::I(n) => n.to_string(),
                A::F(x) => int_of(*x).map(|v| v.to_string()).unwrap_or_else(|| panic!("cannot convert float {} to integer", x)),
                A::S(s) => panic!("%d format: a number is required, not str {:?}", s),
            },
            'f' => fix(num(&a), prec.unwrap_or(6)),
            'e' => exp(num(&a), prec.unwrap_or(6)),
            'g' => gen(num(&a), prec.unwrap_or(6)),
            other => panic!("unsupported conversion %{}", other),
        };
        if matches!(conv, 'd' | 'i' | 'f' | 'e' | 'g') && !s.starts_with('-') {
            if plus {
                s.insert(0, '+');
            } else if space {
                s.insert(0, ' ');
            }
        }
        let n = s.chars().count();
        if n < width {
            let pad = width - n;
            if left {
                s.push_str(&" ".repeat(pad));
            } else if zero && matches!(conv, 'd' | 'i' | 'f' | 'e' | 'g') && !s.contains("nan") && !s.contains("inf") {
                let neg = s.starts_with(['-', '+', ' ']);
                let (sign, rest) = if neg { s.split_at(1) } else { ("", s.as_str()) };
                s = format!("{}{}{}", sign, "0".repeat(pad), rest);
            } else {
                s = format!("{}{}", " ".repeat(pad), s);
            }
        }
        out.push_str(&s);
    }
    if k != args.len() && named.is_empty() {
        panic!("not all arguments converted during string formatting: {:?}", fmt);
    }
    out
}
