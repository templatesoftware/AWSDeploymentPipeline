import {toTitleCase} from "../../lib/utils/title-case";

describe('toTitleCase', () => {
    test('should capitalize the first letter of each word in a single-word string', () => {
        expect(toTitleCase('hello')).toBe('Hello');
    });

    test('should capitalize the first letter of each word in a multi-word string', () => {
        expect(toTitleCase('hello world')).toBe('Hello World');
    });

    test('should handle mixed-case input correctly', () => {
        expect(toTitleCase('hElLo WoRLd')).toBe('Hello World');
    });

    test('should handle strings with extra spaces', () => {
        expect(toTitleCase('   hello   world   ')).toBe('   Hello   World   ');
    });

    test('should handle strings with special characters', () => {
        expect(toTitleCase('hello-world')).toBe('Hello-world');
    });

    test('should handle strings with numbers', () => {
        expect(toTitleCase('hello 123 world')).toBe('Hello 123 World');
    });

    test('should handle an empty string', () => {
        expect(toTitleCase('')).toBe('');
    });

    test('should handle strings with punctuation correctly', () => {
        expect(toTitleCase('hello, world!')).toBe('Hello, World!');
    });

    test('should handle single-character words', () => {
        expect(toTitleCase('a b c d')).toBe('A B C D');
    });

    test('should handle strings with newline characters', () => {
        expect(toTitleCase('hello\nworld')).toBe('Hello\nWorld');
    });

});
