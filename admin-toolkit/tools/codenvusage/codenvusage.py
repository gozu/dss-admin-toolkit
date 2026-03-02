#!/usr/bin/env python
"""
Code Environment Usage Scanner

Scans a Dataiku project for all code environments (Python and R) and reports
exactly where each is used. Maps each code env to specific objects using it
(recipes, notebooks, webapps, scenarios, etc.).

Purpose:
- Inventory all code environments in the current project
- Map each code env to the specific objects using it
- Provide visibility into code env sprawl and usage patterns

Usage:
    Run in a Dataiku Python notebook or as a standalone script
"""

import dataiku
import pandas as pd
from typing import List, Dict, Any


def list_all_code_envs() -> List[Dict]:
    """
    List all Python and R code environments in the instance.

    Returns:
        List of code environment dictionaries with envName, envLang, deploymentMode, etc.
    """
    client = dataiku.api_client()
    all_envs = client.list_code_envs()

    # Filter for Python and R environments
    user_envs = []
    for env in all_envs:
        env_lang = env.get('envLang', '')
        deployment_mode = env.get('deploymentMode', '')

        # Include PYTHON and R environments
        if 'PYTHON' in env_lang or 'R' in env_lang:
            # Optionally exclude plugin-managed
            # if 'PLUGIN_MANAGED' not in deployment_mode:
            user_envs.append(env)

    return user_envs


def get_code_env_usages(env_name: str, env_lang: str) -> List[Dict]:
    """
    Get all usages for a specific code environment.

    Args:
        env_name: Name of the code environment
        env_lang: Language of the code environment (PYTHON_XX or R)

    Returns:
        List of usage dictionaries with:
        - projectKey: Project using the env
        - usageType: RECIPE, NOTEBOOK, WEBAPP_BACKEND, SCENARIO, etc.
        - objectType: Specific object type
        - objectId: Object identifier
        - objectName: Display name
    """
    client = dataiku.api_client()

    try:
        code_env_obj = client.get_code_env(env_lang, env_name)
        usages = code_env_obj.list_usages()
        return usages
    except Exception as e:
        print(f"Error getting usages for {env_lang}:{env_name}: {e}")
        return []


def scan_project_code_envs(project_key: str) -> pd.DataFrame:
    """
    Main function that scans the project for all code environment usages.

    Args:
        project_key: Dataiku project key to scan

    Returns:
        DataFrame with columns: code_env_name, language, object_type,
        object_id, object_name, project_key
    """
    # Get all code environments
    all_envs = list_all_code_envs()

    # Collect all usages
    usage_records = []

    for env in all_envs:
        env_name = env.get('envName')
        env_lang = env.get('envLang')

        print(f"Scanning environment: {env_lang}:{env_name}")

        # Get usages for this env
        usages = get_code_env_usages(env_name, env_lang)

        # Filter to current project
        project_usages = [u for u in usages if u.get('projectKey') == project_key]

        # Convert to records
        for usage in project_usages:
            usage_records.append({
                'code_env_name': env_name,
                'language': env_lang,
                'object_type': usage.get('usageType'),
                'object_id': usage.get('objectId'),
                'object_name': usage.get('objectName', usage.get('objectId')),
                'project_key': usage.get('projectKey'),
            })

        # Track envs with no usage in this project
        if not project_usages and any(u.get('projectKey') != project_key for u in usages):
            # Has usages in other projects but not this one
            pass
        elif not usages:
            # No usages anywhere - mark as unused
            usage_records.append({
                'code_env_name': env_name,
                'language': env_lang,
                'object_type': 'UNUSED',
                'object_id': None,
                'object_name': None,
                'project_key': project_key,
            })

    return pd.DataFrame(usage_records)


def generate_summary(df: pd.DataFrame) -> Dict[str, Any]:
    """
    Generate summary statistics from the usage DataFrame.

    Args:
        df: DataFrame from scan_project_code_envs()

    Returns:
        Dictionary with summary statistics
    """
    # Remove unused entries for counts
    df_used = df[df['object_type'] != 'UNUSED']

    summary = {
        'total_envs': df['code_env_name'].nunique(),
        'python_envs': len(df[df['language'].str.contains('PYTHON', na=False)]['code_env_name'].unique()),
        'r_envs': len(df[df['language'].str.contains('R', na=False) & ~df['language'].str.contains('PYTHON', na=False)]['code_env_name'].unique()),
        'total_usages': len(df_used),
        'unused_envs': len(df[df['object_type'] == 'UNUSED']),
        'usage_by_type': df_used['object_type'].value_counts().to_dict() if len(df_used) > 0 else {},
        'usage_by_env': df_used.groupby('code_env_name').size().sort_values(ascending=False).to_dict() if len(df_used) > 0 else {},
    }

    return summary


def print_summary(summary: Dict[str, Any]):
    """
    Print formatted summary statistics.

    Args:
        summary: Summary dictionary from generate_summary()
    """
    print("\n" + "="*50)
    print("CODE ENVIRONMENT USAGE SUMMARY")
    print("="*50)
    print(f"Total code environments: {summary['total_envs']}")
    print(f"  - Python environments: {summary['python_envs']}")
    print(f"  - R environments: {summary['r_envs']}")
    print(f"\nTotal usages in this project: {summary['total_usages']}")
    print(f"Unused environments: {summary['unused_envs']}")

    if summary['usage_by_type']:
        print("\n" + "-"*50)
        print("USAGE BY OBJECT TYPE")
        print("-"*50)
        for obj_type, count in summary['usage_by_type'].items():
            print(f"  {obj_type}: {count}")

    if summary['usage_by_env']:
        print("\n" + "-"*50)
        print("USAGE BY ENVIRONMENT")
        print("-"*50)
        for env_name, count in summary['usage_by_env'].items():
            print(f"  {env_name}: {count} objects")


def main():
    """
    Main execution function.
    """
    # Get current project key
    project_key = dataiku.default_project_key()

    # Scan for code env usage
    print(f"Scanning project '{project_key}' for code environment usage...")
    print("="*50)

    df_usage = scan_project_code_envs(project_key)

    # Generate and print summary
    summary = generate_summary(df_usage)
    print_summary(summary)

    # Display detailed DataFrame
    print("\n" + "="*50)
    print("DETAILED USAGE")
    print("="*50)

    if len(df_usage) > 0:
        # Sort for better readability
        df_sorted = df_usage.sort_values(['code_env_name', 'object_type', 'object_id'])

        # Try to display (works in notebooks)
        try:
            from IPython.display import display
            display(df_sorted)
        except:
            # Fallback to print
            print(df_sorted.to_string(index=False))
    else:
        print("No code environment usages found in this project.")

    # Return DataFrame for further analysis
    return df_usage


# Execute when run directly or in notebook
if __name__ == "__main__":
    df_result = main()
else:
    # When imported, just expose the functions
    pass
