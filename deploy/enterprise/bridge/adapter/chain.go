package adapter

import "net/http"

// Handler is a bridge middleware step (version adapt, rewrite, audit, …).
type Handler interface {
	ServeHTTP(w http.ResponseWriter, r *http.Request, next http.HandlerFunc)
}

// Chain runs handlers in order, then the terminal handler.
type Chain struct {
	steps []Handler
	end   http.Handler
}

func NewChain(end http.Handler, steps ...Handler) *Chain {
	return &Chain{steps: steps, end: end}
}

func (c *Chain) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var i int
	var run http.HandlerFunc
	run = func(w http.ResponseWriter, r *http.Request) {
		if i >= len(c.steps) {
			c.end.ServeHTTP(w, r)
			return
		}
		step := c.steps[i]
		i++
		step.ServeHTTP(w, r, run)
	}
	run(w, r)
}
