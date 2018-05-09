var assert = require('assert');
var slackHelper = require('./slack-helper')

function compareExpectedAndActual(input, expected) {
    assert.equal(slackHelper.extractEmailAddress(input), expected);
}

describe('slackHelper.extractEmailAddress()', function () {
    describe('wrapped', function () {
        it('should work when Slack wraps addresses in a <mailto:>',
            compareExpectedAndActual('<mailto:john.smith@icloud.com|john.smith@icloud.com>', 'john.smith@icloud.com'));
    });
    describe('wrappedWithoutName', function () {
        it('should work when Slack wraps addresses in a <mailto:>, even if they stop including a name after a pipe',
            compareExpectedAndActual('<mailto:john.smith@icloud.com>', 'john.smith@icloud.com'));
    });
    describe('wrappedWithSpaceInName', function () {
        it('should work when Slack wraps addresses in a <mailto:> with a name inside',
            compareExpectedAndActual('<mailto:john.smith@icloud.com|John Smith>', 'john.smith@icloud.com'));
    });
    describe('wrappedWithWhitespace', function () {
        it('should work even if there is whitespace around the <mailto:> tag',
            compareExpectedAndActual('  <mailto:john.smith@icloud.com|john.smith@icloud.com> ', 'john.smith@icloud.com'));
    });
    describe('unwrapped', function () {
        it('should work even if Slack stops wrapping values',
            compareExpectedAndActual('john.smith@icloud.com', 'john.smith@icloud.com'));
    });
});