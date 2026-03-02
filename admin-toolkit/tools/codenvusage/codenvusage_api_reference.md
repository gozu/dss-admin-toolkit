# Code Environment Usage Scanner - API Reference

## Dataiku API Methods

This document describes the Dataiku Python API methods used by the code environment usage scanner.

---

## Core API Methods

### 1. Get API Client

```python
import dataiku
client = dataiku.api_client()
```

**Returns**: `dataikuapi.dss.DSSClient` object

**Purpose**: Entry point for all DSS API operations

---

### 2. List All Code Environments

```python
all_envs = client.list_code_envs()
```

**Returns**: List of dictionaries, each representing a code environment

**Dictionary Structure**:
```python
{
    'envName': 'my_python39_env',           # Environment name
    'envLang': 'PYTHON39',                   # Language/version
    'deploymentMode': 'DESIGN_MANAGED',      # How it's managed
    'owner': 'admin',                        # Owner username
    'permissions': [...],                    # Permission list
    'usableByAll': True,                     # Available to all users
    'desc': 'Description of environment'     # Optional description
}
```

**Common `envLang` values**:
- `PYTHON27`, `PYTHON36`, `PYTHON37`, `PYTHON38`, `PYTHON39`, `PYTHON310`, `PYTHON311`
- `R` (R version)

**Common `deploymentMode` values**:
- `DESIGN_MANAGED` - Managed in Design node
- `AUTOMATION_SINGLE` - Automation node (single version)
- `AUTOMATION_VERSIONED` - Automation node (versioned)
- `PLUGIN_MANAGED` - Managed by a plugin
- `EXTERNAL_CONDA_NAMED` - External conda environment

**Example**:
```python
client = dataiku.api_client()
all_envs = client.list_code_envs()

# Filter for Python environments only
python_envs = [e for e in all_envs if 'PYTHON' in e.get('envLang', '')]

# Filter for user-managed environments
user_envs = [e for e in all_envs if e.get('deploymentMode') != 'PLUGIN_MANAGED']
```

---

### 3. Get Code Environment Object

```python
code_env = client.get_code_env(env_lang, env_name)
```

**Parameters**:
- `env_lang` (str): Language identifier (e.g., 'PYTHON39', 'R')
- `env_name` (str): Name of the environment

**Returns**: `dataikuapi.dss.codeenv.DSSCodeEnv` object

**Methods available on DSSCodeEnv**:
- `list_usages()` - List all objects using this environment
- `get_definition()` - Get environment definition/settings
- `get_status()` - Get build/update status
- `update_packages()` - Update package list
- `delete()` - Delete the environment

**Example**:
```python
client = dataiku.api_client()
code_env = client.get_code_env('PYTHON39', 'my_python39_env')

# Get environment definition
definition = code_env.get_definition()
print(f"Description: {definition.get('desc')}")
print(f"Packages: {definition.get('specPackageList')}")
```

---

### 4. List Code Environment Usages

```python
usages = code_env.list_usages()
```

**Returns**: List of dictionaries, each representing a usage location

**Dictionary Structure**:
```python
{
    'projectKey': 'MY_PROJECT',              # Project containing the object
    'usageType': 'RECIPE',                   # Type of usage
    'objectType': 'python',                  # Specific object subtype
    'objectId': 'compute_recipe_name',       # Object identifier
    'objectName': 'Compute Recipe Name'      # Display name (may be same as objectId)
}
```

**Common `usageType` values**:
- `RECIPE` - Python/R recipe
- `NOTEBOOK` - Jupyter notebook
- `WEBAPP_BACKEND` - Web app backend (Dash, Bokeh, Standard)
- `SCENARIO` - Scenario Python step
- `LIBRARY` - Project library
- `PROJECT_DEPLOYER` - Project deployment hook

**Example**:
```python
client = dataiku.api_client()
code_env = client.get_code_env('PYTHON39', 'my_python39_env')
usages = code_env.list_usages()

# Filter to specific project
project_usages = [u for u in usages if u['projectKey'] == 'MY_PROJECT']

# Group by usage type
from collections import Counter
usage_counts = Counter(u['usageType'] for u in usages)
print(usage_counts)
# Output: Counter({'RECIPE': 5, 'NOTEBOOK': 3, 'WEBAPP_BACKEND': 1})
```

---

### 5. Get Current Project Key

```python
project_key = dataiku.default_project_key()
```

**Returns**: String with current project key

**Purpose**: Get the key of the project where the code is running (notebook, recipe, etc.)

**Note**: Only works when running inside a Dataiku project context (notebook, recipe). Will raise an error if run outside a project.

**Example**:
```python
import dataiku

# Get current project
project_key = dataiku.default_project_key()
print(f"Running in project: {project_key}")

# Get project object for more operations
client = dataiku.api_client()
project = client.get_project(project_key)
```

---

## Usage Pattern: Complete Scan

Here's the complete pattern for scanning code environment usage:

```python
import dataiku
import pandas as pd

def scan_all_code_env_usages():
    """Scan all code environments and their usages"""

    client = dataiku.api_client()
    current_project = dataiku.default_project_key()

    # Step 1: Get all environments
    all_envs = client.list_code_envs()

    # Step 2: Filter to Python/R
    user_envs = [e for e in all_envs
                 if 'PYTHON' in e.get('envLang', '') or 'R' in e.get('envLang', '')]

    # Step 3: Collect usages
    results = []
    for env in user_envs:
        env_name = env['envName']
        env_lang = env['envLang']

        # Get environment object
        code_env = client.get_code_env(env_lang, env_name)

        # Get all usages
        usages = code_env.list_usages()

        # Filter to current project
        project_usages = [u for u in usages if u['projectKey'] == current_project]

        # Store results
        for usage in project_usages:
            results.append({
                'env_name': env_name,
                'env_lang': env_lang,
                'usage_type': usage['usageType'],
                'object_id': usage['objectId'],
                'object_name': usage.get('objectName', usage['objectId'])
            })

    return pd.DataFrame(results)

# Run the scan
df = scan_all_code_env_usages()
print(df)
```

---

## Alternative: Project Object API

You can also access project objects directly:

### Get Project Object

```python
client = dataiku.api_client()
project = client.get_project('MY_PROJECT')
```

### List Project Recipes

```python
recipes = project.list_recipes()

for recipe in recipes:
    recipe_name = recipe['name']
    recipe_type = recipe['type']  # 'python', 'r', 'sql', etc.

    if recipe_type in ['python', 'pyspark', 'sparkr']:
        # Get recipe object
        recipe_obj = project.get_recipe(recipe_name)
        settings = recipe_obj.get_settings()

        # Try to get code env (method varies by recipe type)
        # settings.get_code_env_settings() or similar
```

### List Project Notebooks

```python
notebooks = project.list_jupyter_notebooks()

for notebook in notebooks:
    notebook_name = notebook.notebook_name or notebook.name

    # Get notebook content
    content = notebook.get_content().get_raw()

    # Check kernel metadata
    metadata = content.get('metadata', {})
    kernelspec = metadata.get('kernelspec', {})
    kernel_name = kernelspec.get('name', '')

    # Parse kernel name to extract code env
    # Pattern: "py-dku-venv-<env_name>" for Python
    # Pattern: "ir-dku-<something>" for R
```

### List Project Webapps

```python
webapps = project.list_webapps()

for webapp in webapps:
    webapp_id = webapp['id']
    webapp_type = webapp['type']  # 'DASH', 'STANDARD', 'BOKEH', etc.

    if webapp_type in ['DASH', 'STANDARD', 'BOKEH']:
        webapp_obj = project.get_webapp(webapp_id)
        settings = webapp_obj.get_settings().get_raw()

        # Look for code env in settings
        # Path varies by webapp type
```

---

## Error Handling

### Common Errors

1. **Permission Error**:
```python
try:
    code_env = client.get_code_env(env_lang, env_name)
except Exception as e:
    if 'not found' in str(e).lower():
        print(f"Environment not found: {env_lang}:{env_name}")
    elif 'permission' in str(e).lower():
        print(f"No permission to access: {env_lang}:{env_name}")
    else:
        raise
```

2. **Project Context Error**:
```python
try:
    project_key = dataiku.default_project_key()
except:
    print("Not running in project context. Specify project key manually:")
    project_key = 'MY_PROJECT'
```

---

## Performance Considerations

1. **Caching**: If scanning multiple times, cache the environment list:
```python
# Cache environment list (changes infrequently)
_env_cache = None

def get_cached_envs():
    global _env_cache
    if _env_cache is None:
        client = dataiku.api_client()
        _env_cache = client.list_code_envs()
    return _env_cache
```

2. **Parallel Processing**: For large instances, consider parallel processing:
```python
from concurrent.futures import ThreadPoolExecutor

def get_env_usages_parallel(envs):
    client = dataiku.api_client()

    def get_usages(env):
        try:
            code_env = client.get_code_env(env['envLang'], env['envName'])
            return code_env.list_usages()
        except:
            return []

    with ThreadPoolExecutor(max_workers=10) as executor:
        results = list(executor.map(get_usages, envs))

    return results
```

3. **Rate Limiting**: For very large instances, add delays:
```python
import time

for env in all_envs:
    usages = get_code_env_usages(env['envName'], env['envLang'])
    # Process usages...
    time.sleep(0.1)  # Small delay between API calls
```

---

## References

- **Dataiku Python API Documentation**: https://doc.dataiku.com/dss/latest/python-api/index.html
- **Code Environment API**: https://doc.dataiku.com/dss/latest/python-api/admin.html#code-envs
- **Project API**: https://doc.dataiku.com/dss/latest/python-api/projects.html

---

## See Also

- `codenvusage.py` - Full implementation
- `codenvusage_minimal.py` - Minimal implementation
- `README_codenvusage.md` - Usage guide
- `codenvusage_notebook_example.py` - Notebook examples
