const users = [
    { name: 'Alice', age: 30, active: true },
    { name: 'Bob', age: 25, active: false },
    { name: 'Charlie', age: 35, active: true }
];

// Get active users over 25
const activeAdults = users.filter(user => user.age > 25).␣