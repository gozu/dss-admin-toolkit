import dataiku

def do(payload, config, plugin_config, inputs):
    # choices = [
    #    { "value" : "val1", "label" : "Value 1"},
    #    { "value" : "val2", "label" : "Value 2"}
    #  ]
    client = dataiku.api_client()
    clusters = client.list_clusters()
    choices = []
    for c in clusters:
        cluster_name = c.get("id", "Cluster not found")
        choices.append({"value": cluster_name, "label": cluster_name})
    # If you want to use whatever is used by default by kubectl
    choices.append({"value": "builtin", "label": "builtin cluster"})
    return {"choices": choices}
