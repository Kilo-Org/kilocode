fn longest(a: &str, b: &str) -> &str {
    if a.len() >= b.len() {
        a
    } else {
        b
    }
}

fn main() {
    let s1 = String::from("hello world");
    let s2 = String::from("hi");
    let out = longest(&s1, &s2);
    println!("longest = {}", out);
}
