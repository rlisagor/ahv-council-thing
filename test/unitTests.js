var assert = require('assert');
var helper = require('../helper');


describe('helper.extractEmailAddress()', function () {
  let compareExpectedAndActual = (input, expected) => {
    assert.equal(helper.extractEmailAddress(input), expected);
  };

  describe('wrapped', function () {
    it('should work when Slack wraps addresses in a <mailto:>', function () {
      compareExpectedAndActual('<mailto:john.smith@icloud.com|john.smith@icloud.com>', 'john.smith@icloud.com');
    });
  });
  describe('wrappedWithoutName', function () {
    it('should work when Slack wraps addresses in a <mailto:>, even if they stop including a name after a pipe', function () {
      compareExpectedAndActual('<mailto:john.smith@icloud.com>', 'john.smith@icloud.com');
    });
  });
  describe('wrappedWithSpaceInName', function () {
    it('should work when Slack wraps addresses in a <mailto:> with a name inside', function () {
      compareExpectedAndActual('<mailto:john.smith@icloud.com|John Smith>', 'john.smith@icloud.com');
    });
  });
  describe('wrappedWithWhitespace', function () {
    it('should work even if there is whitespace around the <mailto:> tag', function () {
      compareExpectedAndActual('  <mailto:john.smith@icloud.com|john.smith@icloud.com> ', 'john.smith@icloud.com');
    });
  });
  describe('unwrapped', function () {
    it('should work even if Slack stops wrapping values', function () {
      compareExpectedAndActual('john.smith@icloud.com', 'john.smith@icloud.com');
    });
  });
});

describe('helper.splitFullName()', () => {
  let compareExpectedAndActual = (input, expected) => {
    assert.deepEqual(helper.splitFullName(input), expected);
  };

  it('should properly split <first last>', () => {
    compareExpectedAndActual('first last', ['first', 'last']);
  });
  it('should properly split <first middle last>', () => {
    compareExpectedAndActual('first middle last', ['first middle', 'last']);
  });
  it('should properly split <first middle1 middle2 last>', () => {
    compareExpectedAndActual('first middle1 middle2 last', ['first middle1 middle2', 'last']);
  });
  it('should properly split <onename>', () => {
    compareExpectedAndActual('onename', ['onename', '']);
  });
  it('should properly split <i. lastname>', () => {
    compareExpectedAndActual('i. lastname', ['i', 'lastname']);
  });
  it('should properly split <a.b.lastname>', () => {
    compareExpectedAndActual('a.b.lastname', ['a b', 'lastname']);
  });
  it('should properly split names with non-latin characters', () => {
    compareExpectedAndActual('Крокодил О. Гена', ['Крокодил О', 'Гена']);
  });
});

