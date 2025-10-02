class User {
    constructor(name, age) {
        this.name = name;
        this.age = age;
    }

    getDisplayName() {
        ␣
    }

    isAdult() {
        return this.age >= 18;
    }
}

const user = new User('Alice', 30);
console.log(user.getDisplayName());