# Install the kubernetes python package
import json
from kubernetes import client, config

# EXAMPLE: get a pod in Error state on purpose
# kubectl run -it --restart=Never --image=infoblox/dnstools:latest -- bash -c "l"

# EXAMPLE: create a fake deployment:
# kubectl create deployment nginx --image=nginx

# EXAMPLE: create a fake service:
# Expose the deployment with a service
# kubectl expose deployment nginx --port 80 --type NodePort

def get_css_table_style():
    return """
    <style>
    table, th, td {
      border: 1px solid black;
      border-collapse: collapse;
    }
    th, td {
      padding: 5px;
    }
    th {
      text-align: left;
    }
    </style>
    """

def load_config(kube_config_path=None):
    # WARNING: needs to run non-impersonated (ie as the dataiku user)
    # config.load_kube_config("/home/dataiku/.kube/config")
    try:
        if kube_config_path is not None:
            config.load_kube_config(kube_config_path)
        else:
            config.load_kube_config(kube_config_path)
    except config.config_exception.ConfigException as e:
        return str(e) + "<br/>Check your kube config file"
    return None

def list_all_pods(kube_config_path=None):
    err = load_config(kube_config_path)
    if err is not None:
        return err
    v1 = client.CoreV1Api()
    ret = v1.list_pod_for_all_namespaces(watch=False)
    #msg = ""
    #for i in ret.items:
    #    msg += "{} &emsp; {} &emsp; {}".format(i.status.pod_ip, i.metadata.namespace, i.metadata.name) + "<br/>"
    msg = get_css_table_style()
    msg += "<table style=\"width:100%\"><tr><th>Pod IP</th><th>Pod Namespace</th><th>Pod Name</th><th>Pod Status Phase (Pod Status Pending/ImagePullBackOff=Pending Phase)</th></tr>"
    for i in ret.items:
        msg += "<tr><td>{}</td><td>{}</td><td>{}</td><td>{}</td></tr>".format(i.status.pod_ip, i.metadata.namespace, i.metadata.name, i.status.phase)
    msg += "</table>"
    return msg

def list_error_pods(kube_config_path= None):
    err = load_config(kube_config_path)
    if err is not None:
        return err
    v1 = client.CoreV1Api()
    ret = v1.list_pod_for_all_namespaces(watch=False)
    #msg = ""
    #for i in ret.items:
    #    if i.status.phase == "Failed":
    #        msg += "{} &emsp; {} &emsp; {}".format(i.status.pod_ip, i.metadata.namespace, i.metadata.name) + "<br/>"
    msg = get_css_table_style()
    msg += "<table style=\"width:100%\"><tr><th>Pod IP</th><th>Pod Namespace</th><th>Pod Name</th><th>Pod Status Phase (Pod Status Pending/ImagePullBackOff=Pending Phase)/th></tr>"
    for i in ret.items:
        if i.status.phase == "Failed":
            msg += "<tr><td>{}</td><td>{}</td><td>{}</td><td>{}</td></tr>".format(i.status.pod_ip, i.metadata.namespace, i.metadata.name, i.status.phase)
    msg += "</table>"
    return msg

def delete_error_pods(kube_config_path=None):
    err = load_config(kube_config_path)
    if err is not None:
        return err
    v1 = client.CoreV1Api()
    ret = v1.list_pod_for_all_namespaces(watch=False)
    msg = ""
    for i in ret.items:
        if i.status.phase == "Failed":
            msg += "Deleting pod: pod ip={} &emsp; pod namespace={} &emsp; pod name={}".format(i.status.pod_ip, i.metadata.namespace, i.metadata.name) + "<br/>"
            v1.delete_namespaced_pod(i.metadata.name, i.metadata.namespace)
    return msg

def delete_non_running_pods(kube_config_path=None):
    err = load_config(kube_config_path)
    if err is not None:
        return err
    v1 = client.CoreV1Api()
    ret = v1.list_pod_for_all_namespaces(watch=False)
    msg = ""
    for i in ret.items:
        if i.status.phase != "Running":
            msg += "Deleting pod: pod ip={} &emsp; pod namespace={} &emsp; pod name={}".format(i.status.pod_ip, i.metadata.namespace, i.metadata.name) + "<br/>"
            v1.delete_namespaced_pod(i.metadata.name, i.metadata.namespace)
    return msg

def list_services(kube_config_path=None):
    err = load_config(kube_config_path)
    if err is not None:
        return err
    v1 = client.CoreV1Api()
    services = v1.list_service_for_all_namespaces(watch=False)
    #msg = ""
    #for svc in services.items:
    #    msg += "svc-ns={} &emsp; svc={} &emsp; svc type={}".format(svc.metadata.namespace, svc.metadata.name, svc.spec.type) + "<br/>"
    msg = get_css_table_style()
    msg += "<table style=\"width:100%\"><tr><th>Service Namespace</th><th>Service Name</th><th>Service Type</th></tr>"
    for svc in services.items:
        msg += "<tr><td>{}</td><td>{}</td><td>{}</td></tr>".format(svc.metadata.namespace, svc.metadata.name, svc.spec.type)
    msg += "</table>"
    return msg
    
def list_deployments(kube_config_path=None):
    err = load_config(kube_config_path)
    if err is not None:
        return err
    v1 = client.AppsV1Api()
    ret = v1.list_deployment_for_all_namespaces()
    #msg = ""
    #for dep in ret.items:
    #    msg += "deployment-ns={} &emsp; deployment={}".format(dep.metadata.namespace, dep.metadata.name) + "<br/>"
    msg = get_css_table_style()
    msg += "<table style=\"width:100%\"><tr><th>Deployment Namespace</th><th>Deployment Name</th></tr>"
    for dep in ret.items:
        msg += "<tr><td>{}</td><td>{}</td></tr>".format(dep.metadata.namespace, dep.metadata.name)
    msg += "</table>"
    return msg

def list_namespaces(kube_config_path=None):
    err = load_config(kube_config_path)
    if err is not None:
        return err
    v1 = client.CoreV1Api()
    namespaces = v1.list_namespace()
    msg = get_css_table_style()
    msg += "<table style=\"width:100%\"><tr><th>Namespace</th></tr>"
    for n in namespaces.items:
        msg += "<tr><td>{}</td></tr>".format(n.metadata.name)
    msg += "</table>"
    return msg

def delete_pod(kube_config_path, namespace, pod_name):
    err = load_config(kube_config_path)
    if err is not None:
        return err
    v1 = client.CoreV1Api()
    ret = v1.list_pod_for_all_namespaces(watch=False)
    pod_to_delete = None
    for p in ret.items:
        if p.metadata.namespace == namespace and p.metadata.name == pod_name:
            pod_to_delete = p
    msg= ""
    if pod_to_delete is None:
        msg = "No pod={} in namespace={} found".format(pod_name, namespace)
    else:
        msg = "Deleting pod={} in namespace={}".format(pod_name, namespace)
        try:
            v1.delete_namespaced_pod(pod_to_delete.metadata.name, pod_to_delete.metadata.namespace)
        except client.exceptions.ApiException as e:
            return str(e).replace("\n", "<br/>")
    return msg
    
def delete_deployment(kube_config_path, namespace, deployment_name):
    err = load_config(kube_config_path)
    if err is not None:
        return err
    v1 = client.AppsV1Api()
    ret = v1.list_deployment_for_all_namespaces()
    msg = ""
    deployment_to_delete = None
    for dep in ret.items:
        if dep.metadata.namespace == namespace and dep.metadata.name == deployment_name:
            deployment_to_delete = dep
    if deployment_to_delete is None:
        msg = "No deployment={} in namespace={} found".format(deployment_name, namespace)
    else:
        msg = "Deleteing deployment={} in namespace={}".format(deployment_name, namespace)
        try:
            v1.delete_namespaced_deployment(deployment_to_delete.metadata.name, deployment_to_delete.metadata.namespace)
        except client.exceptions.ApiException as e:
            return str(e).replace("\n", "<br/>")
    return msg

def delete_service(kube_config_path, namespace, service_name):
    err = load_config(kube_config_path)
    if err is not None:
        return err
    v1 = client.CoreV1Api()
    services = v1.list_service_for_all_namespaces(watch=False)
    msg = ""
    svc_to_delete = None
    for svc in services.items:
        if svc.metadata.namespace == namespace and svc.metadata.name == service_name:
            svc_to_delete = svc
    if svc_to_delete is None:
        msg = "No service={} in namespace={} found".format(service_name, namespace)
    else:
        msg = "Deleting service={} in namespace={}".format(service_name, namespace)
        try:
            v1.delete_namespaced_service(svc_to_delete.metadata.name, svc_to_delete.metadata.namespace)
        except client.exceptions.ApiException as e:
            return str(e).replace("\n", "<br/>")
    return msg

def delete_namespace(kube_config_path, namespace):
    err = load_config(kube_config_path)
    if err is not None:
        return err
    v1 = client.CoreV1Api()
    msg = "Deleting namespace={}".format(namespace)
    try:
        v1.delete_namespace(namespace)
    except client.exceptions.ApiException as e:
        return str(e).replace("\n", "<br/>")
    return msg

def describe_pod(kube_config_path, namespace, pod_name):
    err = load_config(kube_config_path)
    if err is not None:
        return err
    v1 = client.CoreV1Api()
    try:
        res = v1.read_namespaced_pod(pod_name, namespace)
        # json_res = json.dumps(res.to_str())
    except client.exceptions.ApiException as e:
        return str(e)
    res_dict = res.to_dict()
    msg = """
    Name:         {}<br/>
    Namespace:    {}<br/>
    Priority:     {}<br/>
    Node:         {}<br/>
    Start Time:   {}<br/>
    Labels:       {}<br/>
    Annotations:  {}<br/>
    Status:       {}<br/>
<br/>
    Containers:<br/>
      {}
<br/><br/>
    Conditions:<br/>
      {}
<br/><br/>
    Volumes:<br/>
      {}
<br/><br/>
    Node-Selectors:<br/>
      {}
<br/><br/>
    Tolerations:<br/>
      {}
    """.format(res_dict["metadata"]["name"],
               res_dict["metadata"]["namespace"],
               res_dict["spec"]["priority"],
               res.to_dict()["spec"]["node_name"],
               str(res_dict["status"]["start_time"]),
               str(res_dict["metadata"]["labels"]),
               str(res_dict["metadata"]["annotations"]),
               res_dict["status"]["phase"],
               str(res_dict["spec"]["containers"]),
               str(res_dict["status"]["conditions"]),
               str(res_dict["spec"]["volumes"]),
               str(res_dict["spec"]["node_selector"]),
               str(res_dict["spec"]["tolerations"])
              )
    # json_res.replace("\\n", "<br/>")
    return msg

def get_pod_logs(kube_config_path, namespace, pod_name):
    err = load_config(kube_config_path)
    if err is not None:
        return err
    v1 = client.CoreV1Api()
    res = ""
    try:
        res = v1.read_namespaced_pod_log(pod_name, namespace)
    except client.exceptions.ApiException as e:
        res = str(e)
    return res.replace("\n", "<br/>")
