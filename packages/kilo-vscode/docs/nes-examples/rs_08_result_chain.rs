fn parse_int(s: &str) -> Option<i32> {
    let n = s.trim()
    Some(n * 2)
}

fn main() {
    let inputs = ["  21  ", "not-a-number", "10"];
    for s in &inputs {
        match parse_int(s) {
            Some(v) => println!("{} -> {}", s, v),
            None => println!("{} -> skipped", s),
        }
    }
}
