import { createStore } from './state.js';

test('getState returns initial state', () => {
  const store = createStore({ a: 1 });
  expect(store.getState()).toEqual({ a: 1 });
});

test('setState merges patch into state', () => {
  const store = createStore({ a: 1, b: 2 });
  store.setState({ b: 3 });
  expect(store.getState()).toEqual({ a: 1, b: 3 });
});

test('subscribe is called with new state on setState', () => {
  const store = createStore({ a: 1 });
  const seen = [];
  store.subscribe((state) => seen.push(state.a));
  store.setState({ a: 2 });
  store.setState({ a: 3 });
  expect(seen).toEqual([2, 3]);
});

test('unsubscribe stops further notifications', () => {
  const store = createStore({ a: 1 });
  const seen = [];
  const unsubscribe = store.subscribe((state) => seen.push(state.a));
  store.setState({ a: 2 });
  unsubscribe();
  store.setState({ a: 3 });
  expect(seen).toEqual([2]);
});
