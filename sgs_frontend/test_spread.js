class Tx {
  simulate() {}
}
const t = new Tx();
const spread = { ...t, result: 'hack' };
console.log('simulate' in t); // true
console.log('simulate' in spread); // false
