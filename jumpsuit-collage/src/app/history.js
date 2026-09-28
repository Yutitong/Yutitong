// Linear undo/redo over serialized snapshots.
export class History {
  constructor(limit = 100) {
    this.stack = [];
    this.index = -1;
    this.limit = limit;
  }

  push(snapshot) {
    if (this.stack[this.index] === snapshot) return;
    this.stack.length = this.index + 1;
    this.stack.push(snapshot);
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
  }

  canUndo() {
    return this.index > 0;
  }

  canRedo() {
    return this.index < this.stack.length - 1;
  }

  undo() {
    return this.stack[--this.index];
  }

  redo() {
    return this.stack[++this.index];
  }
}
