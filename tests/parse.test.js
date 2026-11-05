const assert = require('assert');
const P = require('../lib/parse.js');

assert.strictEqual(P.parseViews('1.2M views'), 1200000);
assert.strictEqual(P.parseViews('1,234 views'), 1234);
assert.strictEqual(P.parseViews('532K views'), 532000);
assert.strictEqual(P.parseViews('2.1B views'), 2100000000);
assert.strictEqual(P.parseViews('1 view'), 1);
assert.strictEqual(P.parseViews('No views'), 0);
assert.strictEqual(P.parseViews('12,345,678 views • 3 years ago'), 12345678);
assert.strictEqual(P.parseViews('3 years ago'), null);
assert.strictEqual(P.parseViews('19m'), 19000000);
assert.strictEqual(P.parseViews('204K'), 204000);
assert.strictEqual(P.parseViews('7.7m'), 7700000);
assert.strictEqual(P.parseViews('932'), 932);
assert.strictEqual(P.parseViews(''), null);

assert.strictEqual(P.parseDuration('1:02:03'), 3723);
assert.strictEqual(P.parseDuration('4:05'), 245);
assert.strictEqual(P.parseDuration('0:45'), 45);
assert.strictEqual(P.parseDuration('LIVE'), null);
assert.strictEqual(P.parseDuration(null), null);

assert.strictEqual(P.parseISODuration('PT1H2M3S'), 3723);
assert.strictEqual(P.parseISODuration('PT45S'), 45);
assert.strictEqual(P.parseISODuration('PT10M'), 600);
assert.strictEqual(P.parseISODuration('P0D'), 0);

const now = Date.UTC(2026, 0, 1);
assert.strictEqual(P.parseRelativeDate('3 days ago', now), now - 3 * 864e5);
assert.strictEqual(P.parseRelativeDate('Streamed 2 weeks ago', now), now - 2 * 6048e5);
assert.strictEqual(P.parseRelativeDate('nonsense', now), null);
assert.strictEqual(P.parseRelativeDate('1 yr ago', now), now - 31557600000);
assert.strictEqual(P.parseRelativeDate('9 mo ago', now), now - 9 * 2629800000);
assert.strictEqual(P.parseRelativeDate('2 wk ago', now), now - 2 * 6048e5);
assert.strictEqual(P.parseRelativeDate('5 hr ago', now), now - 5 * 36e5);

assert.strictEqual(P.formatDuration(3723), '1:02:03');
assert.strictEqual(P.formatDuration(245), '4:05');
assert.strictEqual(P.formatLong(93784), '1d 2h 3m');
assert.strictEqual(P.formatLong(3723), '1h 2m 3s');
assert.strictEqual(P.formatCount(1234567), '1.23M');
assert.strictEqual(P.formatCount(null), '–');
assert.strictEqual(P.csvEscape('a,"b"'), '"a,""b"""');

console.log('All parse tests passed');
