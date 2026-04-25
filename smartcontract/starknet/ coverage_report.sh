#!/bin/bash

# CAREL Protocol Test Coverage Report

set -e

echo "📊 Generating test coverage report..."

# Create coverage directory
mkdir -p coverage

# Run tests with coverage
echo "Running tests with coverage..."
scarb cairo-test \
    --test-path tests/unit \
    --test-path tests/integration \
    --test-path tests/security \
    --coverage

# Generate coverage report
echo "Generating coverage report..."
scarb cairo-coverage \
    --output-format html \
    --output-dir coverage/html

scarb cairo-coverage \
    --output-format lcov \
    --output-file coverage/lcov.info

# Generate summary
echo "Coverage Summary:"
scarb cairo-coverage summary

# If genhtml is available, generate HTML report
if command -v genhtml &> /dev/null; then
    echo "Generating HTML report..."
    genhtml coverage/lcov.info -o coverage/html-detailed
fi

echo "✅ Coverage report generated in coverage/"
echo "📄 Open coverage/html/index.html in browser"