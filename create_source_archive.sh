#!/bin/bash

# Script to create a zip archive of source code only
# Excludes: node_modules, .git, data directories, images, lock files, etc.

ARCHIVE_NAME="ripipi-source-$(date +%Y%m%d-%H%M%S).zip"
TEMP_DIR="ripipi-source-temp"

echo "Creating source code archive..."

# Create a temporary directory
mkdir -p $TEMP_DIR

# Copy source files to temp directory, preserving structure
echo "Copying source files..."

# Define file extensions to include
SOURCE_EXTENSIONS=(
    "*.ts" "*.tsx" "*.js" "*.jsx" "*.json"
    "*.md" "*.yaml" "*.yml" "*.css" "*.scss" "*.sass"
    "*.html" "*.sh" "Makefile" "Dockerfile"
    ".env.example" ".gitignore" ".dockerignore"
)

# Build find command with all extensions
FIND_CMD="find . -type f \("
FIRST=true
for ext in "${SOURCE_EXTENSIONS[@]}"; do
    if [ "$FIRST" = true ]; then
        FIND_CMD="$FIND_CMD -name \"$ext\""
        FIRST=false
    else
        FIND_CMD="$FIND_CMD -o -name \"$ext\""
    fi
done
FIND_CMD="$FIND_CMD \)"

# Add exclusions
FIND_CMD="$FIND_CMD ! -path \"./node_modules/*\""
FIND_CMD="$FIND_CMD ! -path \"./.git/*\""
FIND_CMD="$FIND_CMD ! -path \"./.turbo/*\""
FIND_CMD="$FIND_CMD ! -path \"./apps/backend/data/*\""
FIND_CMD="$FIND_CMD ! -path \"./.claude/*\""
FIND_CMD="$FIND_CMD ! -path \"./logs/*\""
FIND_CMD="$FIND_CMD ! -path \"./$TEMP_DIR/*\""

# Execute find and copy files
eval $FIND_CMD | while read -r file; do
    # Create directory structure in temp
    DIR=$(dirname "$file")
    mkdir -p "$TEMP_DIR/$DIR"
    # Copy file
    cp "$file" "$TEMP_DIR/$file"
done

# Create zip archive
echo "Creating zip archive: $ARCHIVE_NAME"
cd $TEMP_DIR
zip -r "../$ARCHIVE_NAME" . -q
cd ..

# Clean up temp directory
echo "Cleaning up..."
rm -rf $TEMP_DIR

# Show archive info
if [ -f "$ARCHIVE_NAME" ]; then
    SIZE=$(du -h "$ARCHIVE_NAME" | cut -f1)
    echo "✅ Archive created successfully!"
    echo "📦 File: $ARCHIVE_NAME"
    echo "📊 Size: $SIZE"
    
    # Count files in archive
    FILE_COUNT=$(unzip -l "$ARCHIVE_NAME" 2>/dev/null | grep -c "^[^d]" || echo "0")
    echo "📁 Files: $FILE_COUNT"
else
    echo "❌ Failed to create archive"
    exit 1
fi