import { z } from 'zod';

// Friendlier default messages: "Required" instead of "Invalid input: expected string, received undefined".
z.config({
  customError: (issue) => {
    if (issue.code === 'invalid_type') return issue.input === undefined ? 'Required' : `Must be a ${issue.expected}`;
    if (issue.code === 'invalid_value' && issue.input === undefined) return 'Required';
    if (issue.code === 'unrecognized_keys') return `Unknown field: ${issue.keys.join(', ')}`;
    return undefined;
  },
});
