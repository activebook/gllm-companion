/**
 * Searches for a target value in an array.
 * @param {Array} arr - The array to search through.
 * @param {*} target - The value to look for.
 * @returns {number} - The index of the target, or -1 if not found.
 */
function linearSearch(arr, target) {
  for (let i = 0; i < arr.length; i++) {
    // If the current element matches the target, return its index
    if (arr[i] === target) {
      return i;
    }
  }
  // If we finish the loop without finding it, return -1
  return -1;
}

/**
 * Searches for a target value in a sorted array using binary search.
 * @param {Array} arr - The sorted array to search through.
 * @param {*} target - The value to look for.
 * @returns {number} - The index of the target, or -1 if not found.
 */
function binarySearch(arr, target) {
  let left = 0;
  let right = arr.length - 1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (arr[mid] === target) {
      return mid; // Target found
    } else if (arr[mid] < target) {
      left = mid + 1; // Target is in the right half
    } else {
      right = mid - 1; // Target is in the left half
    }
  }
  return -1; // Target not found
}

// Example usage:
const numbers = [102, 45, 78, 23, 56, 91, 14];
const linearResult = linearSearch(numbers, 23); 
console.log('Linear Search Index:', linearResult); // Output: 3

// Binary search requires a sorted array
const sortedNumbers = [...numbers].sort((a, b) => a - b);
const binaryResult = binarySearch(sortedNumbers, 23);
console.log('Sorted Array:', sortedNumbers);
console.log('Binary Search Index:', binaryResult);

// Performance Comparison
console.log('\n--- Performance Comparison ---');
const largeArraySize = 10000000;
const largeArray = Array.from({ length: largeArraySize }, (_, i) => i);
const targetValue = largeArraySize - 1; // Worst case for linear search

// Measure Linear Search
console.time('Linear Search');
linearSearch(largeArray, targetValue);
console.timeEnd('Linear Search');

// Measure Binary Search (array is already sorted)
console.time('Binary Search');
binarySearch(largeArray, targetValue);
console.timeEnd('Binary Search');

