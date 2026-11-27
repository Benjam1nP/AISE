import { Currency, type Item } from './item';

/**
 * A shopping cart.
 * @trace UC-2
 */
export class Cart {
	private items: Item[] = [];

	constructor(readonly currency: Currency = Currency.Chf) {}

	add(item: Item): void {
		this.items.push(sum(item.cents) > 0 ? item : { ...item, cents: 0 });
	}

	static empty(): Cart {
		return new Cart();
	}

	get size(): number {
		return this.items.length;
	}
}

function sum(...n: number[]): number {
	return n.reduce((a, b) => a + b, 0);
}

export function total(c: Cart): number {
	return c.size * sum(1);
}
