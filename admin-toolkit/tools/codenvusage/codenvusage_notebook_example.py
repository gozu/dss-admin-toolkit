"""
Code Environment Usage Scanner - Notebook Example

This file shows example usage patterns for Dataiku notebooks.
Copy cells into your notebook as needed.

"""

# ============================================================================
# CELL 1: Basic Usage
# ============================================================================

import dataiku
import pandas as pd
import sys

# Add scripts directory to path (if needed)
sys.path.append('/data/projects/configparser/scripts')

# Import the scanner
from codenvusage import scan_project_code_envs, generate_summary, print_summary

# Get current project
project_key = dataiku.default_project_key()
print(f"Scanning project: {project_key}")

# Run the scan
df_usage = scan_project_code_envs(project_key)

# Display results
print(f"\nTotal records: {len(df_usage)}")
display(df_usage.head(20))


# ============================================================================
# CELL 2: Summary Statistics
# ============================================================================

# Generate and display summary
summary = generate_summary(df_usage)
print_summary(summary)


# ============================================================================
# CELL 3: Filter by Object Type
# ============================================================================

# Show only recipes
recipes = df_usage[df_usage['object_type'] == 'RECIPE']
print(f"\nRecipes using code environments: {len(recipes)}")
display(recipes[['code_env_name', 'object_id', 'language']])

# Show only notebooks
notebooks = df_usage[df_usage['object_type'] == 'NOTEBOOK']
print(f"\nNotebooks using code environments: {len(notebooks)}")
display(notebooks[['code_env_name', 'object_id', 'language']])

# Show only webapps
webapps = df_usage[df_usage['object_type'] == 'WEBAPP_BACKEND']
print(f"\nWebapps using code environments: {len(webapps)}")
display(webapps[['code_env_name', 'object_id', 'language']])


# ============================================================================
# CELL 4: Identify Unused Environments
# ============================================================================

# Find unused environments
unused = df_usage[df_usage['object_type'] == 'UNUSED']
if len(unused) > 0:
    print("Unused code environments in this project:")
    print(unused[['code_env_name', 'language']].to_string(index=False))
else:
    print("All code environments are in use!")


# ============================================================================
# CELL 5: Usage by Environment
# ============================================================================

# Count usages per environment
df_used = df_usage[df_usage['object_type'] != 'UNUSED']
usage_counts = df_used.groupby(['code_env_name', 'language']).size().reset_index(name='count')
usage_counts = usage_counts.sort_values('count', ascending=False)

print("Code environment usage counts:")
display(usage_counts)


# ============================================================================
# CELL 6: Visualize Usage (Optional)
# ============================================================================

import matplotlib.pyplot as plt

# Bar chart of usage by environment
df_used = df_usage[df_usage['object_type'] != 'UNUSED']
usage_counts = df_used['code_env_name'].value_counts().head(10)

plt.figure(figsize=(12, 6))
usage_counts.plot(kind='barh')
plt.title('Top 10 Code Environments by Usage')
plt.xlabel('Number of Objects')
plt.ylabel('Code Environment')
plt.tight_layout()
plt.show()

# Pie chart of object types
object_type_counts = df_used['object_type'].value_counts()

plt.figure(figsize=(8, 8))
object_type_counts.plot(kind='pie', autopct='%1.1f%%')
plt.title('Usage by Object Type')
plt.ylabel('')
plt.tight_layout()
plt.show()


# ============================================================================
# CELL 7: Export to Dataset
# ============================================================================

# Export results to a managed dataset
output_dataset_name = 'code_env_usage_report'

try:
    output_dataset = dataiku.Dataset(output_dataset_name)
    output_dataset.write_with_schema(df_usage)
    print(f"✓ Results exported to dataset: {output_dataset_name}")
except Exception as e:
    print(f"Error exporting to dataset: {e}")
    print("\nAlternatively, save to CSV:")
    csv_path = f'/tmp/code_env_usage_{project_key}.csv'
    df_usage.to_csv(csv_path, index=False)
    print(f"✓ Saved to: {csv_path}")


# ============================================================================
# CELL 8: Find All Objects Using a Specific Environment
# ============================================================================

# Specify the environment name to search for
target_env = 'your_env_name_here'  # Change this

objects_using_env = df_usage[df_usage['code_env_name'] == target_env]

if len(objects_using_env) > 0:
    print(f"\nObjects using code environment '{target_env}':")
    display(objects_using_env[['object_type', 'object_id', 'object_name']])
else:
    print(f"No objects found using environment: {target_env}")


# ============================================================================
# CELL 9: Compare Python Versions
# ============================================================================

# Group by Python version
python_envs = df_usage[df_usage['language'].str.contains('PYTHON', na=False)]
python_version_counts = python_envs.groupby('language')['code_env_name'].nunique()

print("Python environments by version:")
print(python_version_counts)

# Show which objects use which Python version
python_usage = python_envs.groupby(['language', 'object_type']).size().reset_index(name='count')
print("\nPython usage by version and object type:")
display(python_usage.pivot(index='object_type', columns='language', values='count').fillna(0))


# ============================================================================
# CELL 10: Validation Tests
# ============================================================================

def validate_results(df_usage):
    """Run validation tests on the results"""

    print("Running validation tests...")

    # Test 1: Check required columns exist
    required_cols = ['code_env_name', 'language', 'object_type', 'object_id']
    assert all(col in df_usage.columns for col in required_cols), "Missing required columns"
    print("✓ All required columns present")

    # Test 2: No null env names (except UNUSED)
    used_envs = df_usage[df_usage['object_type'] != 'UNUSED']
    assert used_envs['code_env_name'].notna().all(), "Found null code_env_name in used entries"
    print("✓ No null code environment names")

    # Test 3: Valid object types
    valid_types = ['RECIPE', 'NOTEBOOK', 'WEBAPP_BACKEND', 'SCENARIO', 'UNUSED', 'LIBRARY', 'PROJECT_DEPLOYER']
    invalid_types = df_usage[~df_usage['object_type'].isin(valid_types)]['object_type'].unique()
    if len(invalid_types) > 0:
        print(f"⚠ Found unexpected object types: {invalid_types}")
    else:
        print("✓ All object types are valid")

    # Test 4: Check for duplicates
    df_used = df_usage[df_usage['object_type'] != 'UNUSED']
    duplicates = df_used.duplicated(subset=['code_env_name', 'object_type', 'object_id']).sum()
    if duplicates > 0:
        print(f"⚠ Found {duplicates} duplicate entries")
    else:
        print("✓ No duplicate entries")

    print("\nValidation complete!")

# Run validation
validate_results(df_usage)


# ============================================================================
# CELL 11: Inline Minimal Version (No Import Needed)
# ============================================================================

"""
If you can't import the module, copy-paste this minimal version:
"""

'''
import dataiku
import pandas as pd

def list_all_code_envs():
    client = dataiku.api_client()
    return [e for e in client.list_code_envs()
            if 'PYTHON' in e.get('envLang', '') or 'R' in e.get('envLang', '')]

def get_code_env_usages(env_name, env_lang):
    client = dataiku.api_client()
    try:
        code_env_obj = client.get_code_env(env_lang, env_name)
        return code_env_obj.list_usages()
    except:
        return []

def scan_project_code_envs(project_key):
    all_envs = list_all_code_envs()
    usage_records = []

    for env in all_envs:
        env_name = env.get('envName')
        env_lang = env.get('envLang')
        usages = get_code_env_usages(env_name, env_lang)
        project_usages = [u for u in usages if u.get('projectKey') == project_key]

        for usage in project_usages:
            usage_records.append({
                'code_env_name': env_name,
                'language': env_lang,
                'object_type': usage.get('usageType'),
                'object_id': usage.get('objectId'),
                'object_name': usage.get('objectName', usage.get('objectId')),
                'project_key': usage.get('projectKey'),
            })

    return pd.DataFrame(usage_records)

# Use it:
project_key = dataiku.default_project_key()
df_usage = scan_project_code_envs(project_key)
display(df_usage)
'''
