package main

import "fmt"

func main() {
	ch := make(chan int)

	go func() {

	}()

	for v := range ch {
		fmt.Println("got:", v)
	}
}
