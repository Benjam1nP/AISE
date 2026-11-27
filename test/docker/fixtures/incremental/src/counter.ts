export class Counter {
	private n = 0;

	increment(): number {
		return ++this.n;
	}
}
