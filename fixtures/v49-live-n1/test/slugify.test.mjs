import test from 'node:test';
import assert from 'node:assert/strict';
import {slugify} from '../src/slugify.mjs';

test('normalizes spaces into one hyphen',()=>assert.equal(slugify('Hello   World'),'hello-world'));
test('removes ASCII punctuation at token boundaries',()=>assert.equal(slugify('  Alpha, Beta!  '),'alpha-beta'));
test('collapses repeated separators',()=>assert.equal(slugify('A---B___C'),'a-b-c'));
test('empty and separator-only input becomes empty',()=>assert.equal(slugify(' _ - _ '),''));
