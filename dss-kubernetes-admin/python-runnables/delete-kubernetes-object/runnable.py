# This file is the actual code for the Python runnable delete-kubernetes-object
from dataiku.runnables import Runnable
import dataiku

from dsskubernetesadmin.dss_k8s_admin_tasks import delete_pod, delete_deployment, delete_service, delete_namespace

class MyRunnable(Runnable):
    """The base interface for a Python runnable"""

    def __init__(self, project_key, config, plugin_config):
        """
        :param project_key: the project in which the runnable executes
        :param config: the dict of the configuration of the object
        :param plugin_config: contains the plugin settings
        """
        self.project_key = project_key
        self.config = config
        self.plugin_config = plugin_config
        
    def get_progress_target(self):
        """
        If the runnable will return some progress info, have this function return a tuple of 
        (target, unit) where unit is one of: SIZE, FILES, RECORDS, NONE
        """
        return None

    def run(self, progress_callback):
        """
        Do stuff here. Can return a string or raise an exception.
        The progress_callback is a function expecting 1 value: current progress
        """
        output = ""
        object_type = self.config.get("object_type", None)
        namespace = self.config.get("namespace", "default")
        object_name = self.config.get("object_name", None)
        if object_name is None and object_type != "namespace":
            return "Kubernetes object name is empty. Please enter a Kubernetes object name."
        cluster = self.config.get("k8s_cluster", "builtin") # If the value is not there, let's use the default
        kube_config_path = None
        if cluster == "builtin":
            kube_config_path = None # no need to pass kube_config_path as a parameter
        if cluster != "builtin":
            dss_client = dataiku.api_client()
            cluster = dss_client.get_cluster(cluster)
            cluster_settings = cluster.get_settings()
            cluster_raw_settings = cluster_settings.get_raw()
            cluster_data = cluster_raw_settings.get("data", None)
            if cluster_data is not None:
                kube_config_path = cluster_data.get("kube_config_path", None)
        output = ""
        if object_type is None:
            output += "No object to delete"
        elif object_type == "pod":
            output += delete_pod(kube_config_path, namespace, object_name)
        elif object_type == "deployment":
            output += delete_deployment(kube_config_path, namespace, object_name)
        elif object_type == "service":
            output += delete_service(kube_config_path, namespace, object_name)
        elif object_type == "namespace":
            output += delete_namespace(kube_config_path, namespace)
        return output
        