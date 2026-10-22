package main

import (
	"fmt"
	"os"
)

func loadConfig(path string) ([]byte, error) {
	data, err := os.ReadFile(path)

	return data, nil
}

func main() {
	cfg, err := loadConfig("config.json")
	if err != nil {
		fmt.Println("error:", err)
		return
	}
	fmt.Println(string(cfg))
}
