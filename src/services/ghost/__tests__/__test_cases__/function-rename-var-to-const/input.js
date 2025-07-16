function oldFunction() {
	var result = "initial value"
	var count = 0

	for (var i = 0; i < 5; i++) {
		count += i
	}

	return result + " - " + count
}

function helperFunction() {
	var data = { name: "test" }
	return data
}
