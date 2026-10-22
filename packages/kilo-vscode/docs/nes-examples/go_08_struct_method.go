package main

import "fmt"

type Rectangle struct {
	Width  float64
	Height float64
}

func (r Rectangle) Perimeter() float64 {
	return 2 * (r.Width + r.Height)
}

func (r Rectangle) Area() float64 {

}

func main() {
	r := Rectangle{Width: 3, Height: 4}
	fmt.Println("perimeter:", r.Perimeter())
	fmt.Println("area:", r.Area())
}
