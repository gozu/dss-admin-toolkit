# Code Environment Usage Scanner

## Overview

Scans a Dataiku project for all code environments (Python and R) and reports exactly where each is used.

## Purpose

- **Inventory** all code environments in the current project
- **Map** each code env to specific objects using it (recipes, notebooks, webapps, scenarios, etc.)
- **Provide visibility** into code env sprawl and usage patterns

## Files

- **`codenvusage.py`** - Full-featured version with detailed summaries and error handling
- **`codenvusage_minimal.py`** - Minimal 80-line version for quick scanning

## Usage

### In Dataiku Notebook

#### Option 1: Full Version
```python
# Import and run the scanner
import sys
sys.path.append('/data/projects/configparser/scripts')

from codenvusage import main, scan_project_code_envs, generate_summary

# Run full scan with summary
df_usage = main()

# Or run individual functions
project_key = dataiku.default_project_key()
df_usage = scan_project_code_envs(project_key)
summary = generate_summary(df_usage)
```

#### Option 2: Minimal Version
```python
# Copy-paste the minimal version directly into notebook cells
# Or import it
import sys
sys.path.append('/data/projects/configparser/scripts')

from codenvusage_minimal import scan_project_code_envs
import dataiku

project_key = dataiku.default_project_key()
df_usage = scan_project_code_envs(project_key)
display(df_usage)
```

#### Option 3: Inline (No Import)
```python
# Just copy the code from codenvusage_minimal.py
# and paste into notebook cells
import dataiku
import pandas as pd

def list_all_code_envs():
    client = dataiku.api_client()
    return [e for e in client.list_code_envs()
            if 'PYTHON' in e.get('envLang', '') or 'R' in e.get('envLang', '')]

# ... rest of the code ...

project_key = dataiku.default_project_key()
df_usage = scan_project_code_envs(project_key)
display(df_usage)
```

## Output

### DataFrame Columns

| Column | Description |
|--------|-------------|
| `code_env_name` | Name of the code environment |
| `language` | PYTHON_27, PYTHON_36, PYTHON_39, R, etc. |
| `object_type` | RECIPE, NOTEBOOK, WEBAPP_BACKEND, SCENARIO, UNUSED |
| `object_id` | Identifier of the object (recipe name, notebook name, etc.) |
| `object_name` | Display name of the object |
| `project_key` | Project key |

### Summary Statistics

The full version (`codenvusage.py`) provides:
- Total code environments (by language)
- Total usages in the project
- Unused environments
- Usage breakdown by object type
- Usage breakdown by environment

## Examples

### Example 1: Find All Python Recipe Dependencies
```python
df_usage = scan_project_code_envs(project_key)
python_recipes = df_usage[
    (df_usage['object_type'] == 'RECIPE') &
    (df_usage['language'].str.contains('PYTHON'))
]
print(python_recipes[['object_id', 'code_env_name']])
```

### Example 2: Identify Unused Environments
```python
df_usage = scan_project_code_envs(project_key)
unused = df_usage[df_usage['object_type'] == 'UNUSED']
print(f"Unused environments: {list(unused['code_env_name'].unique())}")
```

### Example 3: Count Usage by Environment
```python
df_usage = scan_project_code_envs(project_key)
df_used = df_usage[df_usage['object_type'] != 'UNUSED']
usage_counts = df_used['code_env_name'].value_counts()
print(usage_counts)
```

### Example 4: Export to Dataset
```python
df_usage = scan_project_code_envs(project_key)

# Save to CSV dataset
output_dataset = dataiku.Dataset('code_env_usage_report')
output_dataset.write_with_schema(df_usage)
```

## API Methods Used

| API Method | Purpose |
|------------|---------|
| `dataiku.api_client()` | Get Dataiku DSS client |
| `client.list_code_envs()` | List all code environments in instance |
| `client.get_code_env(lang, name)` | Get specific code environment object |
| `code_env_obj.list_usages()` | Get all usages of the environment |
| `dataiku.default_project_key()` | Get current project key |

## Key Differences: Python vs R

- **Python**: Can have many code environments per instance (PYTHON_27, PYTHON_36, PYTHON_39, etc.)
- **R**: Typically has a single version in the instance (but can still have multiple R environments)

## Object Types Detected

- `RECIPE` - Python/R recipes
- `NOTEBOOK` - Jupyter notebooks
- `WEBAPP_BACKEND` - Webapp backends (Dash, Standard, Bokeh)
- `SCENARIO` - Scenario Python steps
- `LIBRARY` - Project libraries
- `UNUSED` - Environments with no usages

## Validation

### Expected Behavior
```python
# Test the output
df_usage = scan_project_code_envs(project_key)

# Check columns exist
assert all(col in df_usage.columns for col in
    ['code_env_name', 'language', 'object_type', 'object_id'])

# No null env names (except UNUSED entries)
used_envs = df_usage[df_usage['object_type'] != 'UNUSED']
assert used_envs['code_env_name'].notna().all()

# Valid object types
valid_types = ['RECIPE', 'NOTEBOOK', 'WEBAPP_BACKEND', 'SCENARIO', 'UNUSED', 'LIBRARY']
assert df_usage['object_type'].isin(valid_types).all()

print("✓ All validations passed")
```

## Performance

- **Typical project** (10-50 objects): < 10 seconds
- **Medium project** (50-100 objects): 10-30 seconds
- **Large project** (100+ objects): 30 seconds - 2 minutes

The script scans all environments in the instance but only reports usages for the current project.

## Troubleshooting

### Error: "No module named 'dataiku'"
- Ensure you're running in a Dataiku Python notebook or have the Dataiku API client installed

### Error: "Permission denied"
- Ensure you have read access to the project and admin access to view code environments

### No usages found
- Check that the project actually uses code environments
- Some objects may use the default built-in environment which may not be listed

### Script is slow
- The script queries all environments in the instance
- For instances with 50+ environments, consider filtering by deployment mode or language

## Enhancement Ideas

1. **Add visualization**:
```python
import matplotlib.pyplot as plt

df_used = df_usage[df_usage['object_type'] != 'UNUSED']
df_used['code_env_name'].value_counts().plot(kind='barh', figsize=(10, 6))
plt.title('Code Environment Usage')
plt.xlabel('Number of Objects')
plt.show()
```

2. **Add detailed object info**:
   - Recipe type (python, pyspark, sparkr)
   - Notebook kernel display name
   - Last modification date
   - Object owner

3. **Cross-project analysis**:
   - Scan multiple projects
   - Find shared code environments
   - Identify candidates for consolidation

## References

- Based on patterns from `/data/projects/pythonaudit/`
- API examples from `/data/projects/configparser/webapps/diag-parser-live/backend.py` (lines 3182-3196)

## License

Part of the configparser project.
