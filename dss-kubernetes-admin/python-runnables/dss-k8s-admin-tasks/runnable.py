# This file is the actual code for the Python runnable dss-k8s-admin-tasks
from dataiku.runnables import Runnable
import dataiku

from dsskubernetesadmin.dss_k8s_admin_tasks import list_all_pods, list_error_pods, delete_error_pods, list_services, list_deployments, delete_non_running_pods
from dsskubernetesadmin.dss_k8s_admin_tasks import list_namespaces

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
        task_to_execute = self.config.get("task_to_execute", None)
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
        if task_to_execute is None:
            output = "No task to execute"
        elif task_to_execute == "list_all_pods":
            output = list_all_pods(kube_config_path)
        elif task_to_execute == "list_error_pods":
            output = list_error_pods(kube_config_path)
        elif task_to_execute == "delete_error_pods":
            output = delete_error_pods(kube_config_path)
        elif task_to_execute == "delete_non_running_pods":
            output = delete_non_running_pods(kube_config_path)
        elif task_to_execute == "list_services":
            output = list_services(kube_config_path)
        elif task_to_execute == "list_deployments":
            output = list_deployments(kube_config_path)
        elif task_to_execute == "list_namespaces":
            output = list_namespaces(kube_config_path)
        return output
        