enum Shape {
    Circle(f64),
    Square(f64),
    Rectangle(f64, f64),
    Triangle(f64, f64),
}

fn area(s: &Shape) -> f64 {
    match s {
        Shape::Circle(r) => std::f64::consts::PI * r * r,
        Shape::Square(side) => side * side,

    }
}

fn main() {
    let shapes = vec![
        Shape::Circle(1.0),
        Shape::Rectangle(2.0, 3.0),
        Shape::Triangle(4.0, 5.0),
    ];
    for s in &shapes {
        println!("area = {}", area(s));
    }
}
