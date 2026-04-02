import os
import shutil
import glob

# Ensure www exists
if not os.path.exists('www'):
    os.makedirs('www')

# Core files
files_to_copy = ['index.html', 'style.css', 'app.js', 'logo.png', 'hero.png', 'data.json', 'capacitor.config.json', 'package.json']

for f in files_to_copy:
    if os.path.exists(f):
        shutil.copy(f, 'www/')
        print(f"Copied {f} to www/")
    else:
        print(f"Warning: {f} not found!")

# Any other pngs
for png in glob.glob("*.png"):
    if png not in files_to_copy:
        shutil.copy(png, 'www/')
        print(f"Copied {png} to www/")

print("✅ Build assets prepared in www/")
