import {getFormattedDateForFilePath} from "../../lib/utils/date-time";

describe('Date path formatting', () => {
    it('should return the current date and time in the correct format', () => {
        //month is 0 index so it is January
        const date = new Date(2023, 0, 24, 11, 22, 33)
        console.log(date.toISOString()); // Should output: 2023-01-24T11:22:33.000Z
        const result = getFormattedDateForFilePath(date);
        expect(result).toBe('2023-01-24_11-22-33');
    });
});
