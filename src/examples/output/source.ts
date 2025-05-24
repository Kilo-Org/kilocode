
// Source file with multiple declarations
import { something } from './somewhere';

// Another function that will stay
function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

// This will stay
const TAX_RATE = 0.07;
