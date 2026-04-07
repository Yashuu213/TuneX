import subprocess
import os

def run(cmd):
    print(f"\n🚀 Running: {cmd}")
    try:
        result = subprocess.run(cmd, shell=True, check=True, capture_output=True, text=True)
        print(result.stdout)
    except subprocess.CalledProcessError as e:
        print(f"❌ FAILED: {cmd}")
        print(e.stdout)
        print(e.stderr)
        return False
    return True

print("🛠️ SIMULATING GITHUB ACTION BUILD...")

if not run("npm install"):
    exit(1)

if not run("python build_www.py"):
    exit(1)

if not run("npx cap sync android"):
    exit(1)

print("\n✅ LOCAL SIMULATION SUCCESSFUL!")
