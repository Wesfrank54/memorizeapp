import { test } from 'node:test';

test('mock module check', async (t) => {
  console.log('inside test, t.mock type:', typeof t.mock);
  console.log('t.mock keys:', Object.getOwnPropertyNames(t.mock));
  console.log('t.mock.module type:', typeof t.mock?.module);
  if (typeof t.mock?.module === 'function') {
    t.mock.module('node:fs', {
      namedExports: { readFileSync: () => 'mocked' }
    });
    console.log('module mock api works');
  } else {
    console.log('no module mock, will use other strategy');
  }
});
