#!/usr/bin/env python
"""
Code Environment Usage Scanner - Minimal Version

Minimal working script (~80 lines) for scanning code environment usage.
This is a production-ready version covering core requirements.

Usage:
    Run in a Dataiku Python notebook
"""

import dataiku
import pandas as pd


def list_all_code_envs():
    """List all Python and R code environments"""
    client = dataiku.api_client()
    return [e for e in client.list_code_envs()
            if 'PYTHON' in e.get('envLang', '') or 'R' in e.get('envLang', '')]


def get_code_env_usages(env_name, env_lang):
    """Get all objects using this code environment"""
    client = dataiku.api_client()
    try:
        code_env_obj = client.get_code_env(env_lang, env_name)
        return code_env_obj.list_usages()
    except:
        return []


def scan_project_code_envs(project_key):
    """Scan project for all code env usages"""
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

        # Mark unused envs
        if not project_usages and not usages:
            usage_records.append({
                'code_env_name': env_name,
                'language': env_lang,
                'object_type': 'UNUSED',
                'object_id': None,
                'object_name': None,
                'project_key': project_key,
            })

    return pd.DataFrame(usage_records)


# Main execution
if __name__ == "__main__":
    project_key = dataiku.default_project_key()
    print(f"Scanning project '{project_key}' for code environment usage...")

    df_usage = scan_project_code_envs(project_key)

    print(f"\nFound {len(df_usage)} code env usages in project {project_key}")
    print("\nCode environments in use:")
    print(df_usage['code_env_name'].value_counts())

    print("\nUsage by object type:")
    print(df_usage[df_usage['object_type'] != 'UNUSED']['object_type'].value_counts())

    print("\n" + "="*50)
    print("DETAILED USAGE")
    print("="*50)

    # Display results
    try:
        from IPython.display import display
        display(df_usage.sort_values(['code_env_name', 'object_type']))
    except:
        print(df_usage.sort_values(['code_env_name', 'object_type']).to_string(index=False))
