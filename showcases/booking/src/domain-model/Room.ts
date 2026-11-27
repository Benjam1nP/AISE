/**
 * Meeting room entity.
 *
 * @trace DSN-001 REQ-001 REQ-005 REQ-012
 */
export class Room {
  constructor(public id: string, public name: string, public capacity: number, public floor: number, public equipment: string[], public active: boolean) {}
}
