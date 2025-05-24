
// Target file with existing code
import { otherThing } from './elsewhere';

// Existing utility function
function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

export // A function to move
function calculateTotal(items: number[]): number {
  let total = 0;
  for (const item of items) {
    total += item;
  }
  return total;
}

export // A class to move
class Product {
  id: string;
  name: string;
  price: number;
  
  constructor(id: string, name: string, price: number) {
    this.id = id;
    this.name = name;
    this.price = price;
  }
  
  getFormattedPrice(): string {
    return formatCurrency(this.price);
  }
}
