/**
 * Accepted bid stored in item currency.
 *
 * @trace DSN-016 REQ-002
 */
export class Bid {
  constructor(
    public id: string,
    public itemId: string,
    public bidderId: string,
    public amount: number,
    public placedAt: Date,
  ) {}
}
