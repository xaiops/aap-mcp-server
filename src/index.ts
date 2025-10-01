#!/usr/bin/env node

import { config } from "dotenv";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { getToolsFromOpenApi } from "openapi-mcp-generator";
import { readFileSync } from "fs";
import { join } from "path";

// Load environment variables
config();

// Load OpenAPI specifications
const loadOpenApiSpecs = () => {
  const specFiles = [
    "aap-controller-api_26-devel.json",
    "aap-gateway-api_25.json",
    //"ansible-ai-connect-service.json",
  ];
  const specs = specFiles.map((fileName) =>
    JSON.parse(
      readFileSync(join(process.cwd(), "openapi", fileName), "utf8")
    )
  );
  console.log(`Number of OpenAPIv3 files=${specs.length}`)

  return specs;
};

// Generate tools from OpenAPI specs
const generateTools = async () => {
  const openApiSpecs = loadOpenApiSpecs();
  let rawToolList: any[] = [];

  for (const spec of openApiSpecs) {
    try {
      const tools = await getToolsFromOpenApi(spec, {
        baseUrl: "http://localhost:44926",
        dereference: true,
//        filterFn: (tool) => {
//          return tool.method.toLowerCase() === 'get';
//        },
      });
      tools.filter((tool) => {tool.description = tool.description.split('\n\n')[0]});
      tools.forEach((tool) => {console.log(`>${tool.description}--`)});
      rawToolList = rawToolList.concat(tools);
      //rawToolList = rawToolList.concat(shorterTools);
    } catch (error) {
      console.error("Error generating tools from OpenAPI spec:", error);
    }
  }


  const allowList = [
    // "api_list",
    // "api_debug_list",
    // "api_debug_dependency_manager_list",
    // "api_debug_task_manager_list",
    // "api_debug_workflow_manager_list",
    // "api_read",
    // "api_activity_stream_list",
    // "api_activity_stream_read",
    // "api_ad_hoc_command_events_read",
    // "api_ad_hoc_commands_list",
    // "api_ad_hoc_commands_create",
    // "api_ad_hoc_commands_read",
    // "api_ad_hoc_commands_delete",
    // "api_ad_hoc_commands_activity_stream_list",
    // "api_ad_hoc_commands_cancel_read",
    // "api_ad_hoc_commands_cancel_create",
    // "api_ad_hoc_commands_events_list",
    // "api_ad_hoc_commands_notifications_list",
    // "api_ad_hoc_commands_relaunch_list",
    // "api_ad_hoc_commands_relaunch_create",
    // "api_ad_hoc_commands_stdout_read",
    // "api_analytics_list",
    // "api_analytics_adoption_rate_list",
    // "api_analytics_adoption_rate_create",
    // "api_analytics_adoption_rate_options_list",
    // "api_analytics_adoption_rate_options_create",
    // "api_analytics_authorized_list",
    // "api_analytics_authorized_create",
    // "api_analytics_event_explorer_list",
    // "api_analytics_event_explorer_create",
    // "api_analytics_event_explorer_options_list",
    // "api_analytics_event_explorer_options_create",
    // "api_analytics_host_explorer_list",
    // "api_analytics_host_explorer_create",
    // "api_analytics_host_explorer_options_list",
    // "api_analytics_host_explorer_options_create",
    // "api_analytics_job_explorer_list",
    // "api_analytics_job_explorer_create",
    // "api_analytics_job_explorer_options_list",
    // "api_analytics_job_explorer_options_create",
    // "api_analytics_probe_template_for_hosts_list",
    // "api_analytics_probe_template_for_hosts_create",
    // "api_analytics_probe_template_for_hosts_options_list",
    // "api_analytics_probe_template_for_hosts_options_create",
    // "api_analytics_probe_templates_list",
    // "api_analytics_probe_templates_create",
    // "api_analytics_probe_templates_options_list",
    // "api_analytics_probe_templates_options_create",
    // "api_analytics_report_read",
    // "api_analytics_report_create",
    // "api_analytics_report_options_list",
    // "api_analytics_report_options_create",
    // "api_analytics_reports_list",
    // "api_analytics_reports_create",
    // "api_analytics_roi_templates_list",
    // "api_analytics_roi_templates_create",
    // "api_analytics_roi_templates_options_list",
    // "api_analytics_roi_templates_options_create",
    // "api_bulk_list",
    // "api_bulk_host_create_list",
    // "api_bulk_host_create_create",
    // "api_bulk_host_delete_list",
    // "api_bulk_host_delete_create",
    // "api_bulk_job_launch_list",
    // "api_bulk_job_launch_create",
    // "api_config_list",
    // "api_config_create",
    // "api_config_delete",
    // "api_config_attach_create",
    // "api_config_subscriptions_create",
    // "api_constructed_inventories_list",
    // "api_constructed_inventories_create",
    // "api_constructed_inventories_read",
    // "api_constructed_inventories_update",
    // "api_constructed_inventories_delete",
    // "api_constructed_inventories_partial_update",
    // "api_credential_input_sources_list",
    // "api_credential_input_sources_create",
    // "api_credential_input_sources_read",
    // "api_credential_input_sources_update",
    // "api_credential_input_sources_delete",
    // "api_credential_input_sources_partial_update",
    // "api_credential_types_list",
    // "api_credential_types_create",
    // "api_credential_types_read",
    // "api_credential_types_update",
    // "api_credential_types_delete",
    // "api_credential_types_partial_update",
    // "api_credential_types_activity_stream_list",
    // "api_credential_types_credentials_list",
    // "api_credential_types_credentials_create",
    // "api_credential_types_test_read",
    // "api_credential_types_test_create",
    // "api_credentials_list",
    // "api_credentials_create",
    // "api_credentials_read",
    // "api_credentials_update",
    // "api_credentials_delete",
    // "api_credentials_partial_update",
    // "api_credentials_access_list_list",
    // "api_credentials_activity_stream_list",
    // "api_credentials_copy_list",
    // "api_credentials_copy_create",
    // "api_credentials_input_sources_list",
    // "api_credentials_input_sources_create",
    // "api_credentials_object_roles_list",
    // "api_credentials_owner_teams_list",
    // "api_credentials_owner_users_list",
    // "api_credentials_test_read",
    // "api_credentials_test_create",
    // "api_dashboard_list",
    // "api_dashboard_graphs_jobs_list",
    // "api_execution_environments_list",
    // "api_execution_environments_create",
    // "api_execution_environments_read",
    // "api_execution_environments_update",
    // "api_execution_environments_delete",
    // "api_execution_environments_partial_update",
    // "api_execution_environments_activity_stream_list",
    // "api_execution_environments_copy_list",
    // "api_execution_environments_copy_create",
    // "api_execution_environments_unified_job_templates_list",
    // "api_v2_feature_flags_state_list",
    "api_groups_list",
    "api_groups_create",
    "api_groups_read",
    "api_groups_update",
    "api_groups_delete",
    "api_groups_partial_update",
    "api_groups_activity_stream_list",
    "api_groups_ad_hoc_commands_list",
    "api_groups_ad_hoc_commands_create",
    "api_groups_all_hosts_list",
    "api_groups_children_list",
    "api_groups_children_create",
    "api_groups_hosts_list",
    "api_groups_hosts_create",
    "api_groups_inventory_sources_list",
    "api_groups_job_events_list",
    "api_groups_job_host_summaries_list",
    "api_groups_potential_children_list",
    "api_groups_variable_data_read",
    "api_groups_variable_data_update",
    "api_groups_variable_data_partial_update",
    "api_host_metric_summary_monthly_list",
    "api_host_metrics_list",
    "api_host_metrics_read",
    "api_host_metrics_delete",
    "api_hosts_list",
    "api_hosts_create",
    "api_hosts_read",
    "api_hosts_update",
    "api_hosts_delete",
    "api_hosts_partial_update",
    "api_hosts_activity_stream_list",
    "api_hosts_ad_hoc_command_events_list",
    "api_hosts_ad_hoc_commands_list",
    "api_hosts_ad_hoc_commands_create",
    "api_hosts_all_groups_list",
    "api_hosts_ansible_facts_read",
    "api_hosts_groups_list",
    "api_hosts_groups_create",
    "api_hosts_inventory_sources_list",
    "api_hosts_job_events_list",
    "api_hosts_job_host_summaries_list",
    "api_hosts_smart_inventories_list",
    "api_hosts_variable_data_read",
    "api_hosts_variable_data_update",
    "api_hosts_variable_data_partial_update",
    "api_instance_groups_list",
    "api_instance_groups_create",
    "api_instance_groups_read",
    "api_instance_groups_update",
    "api_instance_groups_delete",
    "api_instance_groups_partial_update",
    "api_instance_groups_access_list_list",
    "api_instance_groups_instances_list",
    "api_instance_groups_instances_create",
    "api_instance_groups_jobs_list",
    "api_instance_groups_object_roles_list",
    "api_instances_list",
    "api_instances_create",
    "api_instances_read",
    "api_instances_update",
    "api_instances_partial_update",
    "api_instances_health_check_list",
    "api_instances_health_check_create",
    "api_instances_install_bundle_list",
    "api_instances_instance_groups_list",
    "api_instances_instance_groups_create",
    "api_instances_jobs_list",
    "api_instances_peers_list",
    "api_instances_receptor_addresses_list",
    "api_inventories_list",
    "api_inventories_create",
    "api_inventories_read",
    "api_inventories_update",
    "api_inventories_delete",
    "api_inventories_partial_update",
    "api_inventories_access_list_list",
    "api_inventories_activity_stream_list",
    "api_inventories_ad_hoc_commands_list",
    "api_inventories_ad_hoc_commands_create",
    "api_inventories_copy_list",
    "api_inventories_copy_create",
    "api_inventories_groups_list",
    "api_inventories_groups_create",
    "api_inventories_hosts_list",
    "api_inventories_hosts_create",
    "api_inventories_input_inventories_list",
    "api_inventories_input_inventories_create",
    "api_inventories_instance_groups_list",
    "api_inventories_instance_groups_create",
    "api_inventories_inventory_sources_list",
    "api_inventories_inventory_sources_create",
    "api_inventories_job_templates_list",
    "api_inventories_labels_list",
    "api_inventories_labels_create",
    "api_inventories_object_roles_list",
    "api_inventories_root_groups_list",
    "api_inventories_root_groups_create",
    "api_inventories_script_read",
    "api_inventories_tree_read",
    "api_inventories_update_inventory_sources_read",
    "api_inventories_update_inventory_sources_create",
    "api_inventories_variable_data_read",
    "api_inventories_variable_data_update",
    "api_inventories_variable_data_partial_update",
    "api_inventory_sources_list",
    "api_inventory_sources_create",
    "api_inventory_sources_read",
    "api_inventory_sources_update",
    "api_inventory_sources_delete",
    "api_inventory_sources_partial_update",
    "api_inventory_sources_activity_stream_list",
    "api_inventory_sources_credentials_list",
    "api_inventory_sources_credentials_create",
    "api_inventory_sources_groups_list",
    "api_inventory_sources_groups_delete",
    "api_inventory_sources_hosts_list",
    "api_inventory_sources_hosts_delete",
    "api_inventory_sources_inventory_updates_list",
    "api_inventory_sources_notification_templates_error_list",
    "api_inventory_sources_notification_templates_error_create",
    "api_inventory_sources_notification_templates_started_list",
    "api_inventory_sources_notification_templates_started_create",
    "api_inventory_sources_notification_templates_success_list",
    "api_inventory_sources_notification_templates_success_create",
    "api_inventory_sources_schedules_list",
    "api_inventory_sources_schedules_create",
    "api_inventory_sources_update_read",
    "api_inventory_sources_update_create",
    "api_inventory_updates_list",
    "api_inventory_updates_read",
    "api_inventory_updates_delete",
    "api_inventory_updates_cancel_read",
    "api_inventory_updates_cancel_create",
    "api_inventory_updates_credentials_list",
    "api_inventory_updates_events_list",
    "api_inventory_updates_notifications_list",
    "api_inventory_updates_stdout_read",
    "api_job_events_read",
    "api_job_events_children_list",
    "api_job_host_summaries_read",
    "api_job_templates_list",
    "api_job_templates_create",
    "api_job_templates_read",
    "api_job_templates_update",
    "api_job_templates_delete",
    "api_job_templates_partial_update",
    "api_job_templates_access_list_list",
    "api_job_templates_activity_stream_list",
    "api_job_templates_bitbucket_dc_create",
    "api_job_templates_callback_list",
    "api_job_templates_callback_create",
    "api_job_templates_copy_list",
    "api_job_templates_copy_create",
    "api_job_templates_credentials_list",
    "api_job_templates_credentials_create",
    "api_job_templates_github_create",
    "api_job_templates_gitlab_create",
    "api_job_templates_instance_groups_list",
    "api_job_templates_instance_groups_create",
    "api_job_templates_jobs_list",
    "api_job_templates_labels_list",
    "api_job_templates_labels_create",
    "api_job_templates_launch_read",
    "api_job_templates_launch_create",
    "api_job_templates_notification_templates_error_list",
    "api_job_templates_notification_templates_error_create",
    "api_job_templates_notification_templates_started_list",
    "api_job_templates_notification_templates_started_create",
    "api_job_templates_notification_templates_success_list",
    "api_job_templates_notification_templates_success_create",
    "api_job_templates_object_roles_list",
    "api_job_templates_schedules_list",
    "api_job_templates_schedules_create",
    "api_job_templates_slice_workflow_jobs_list",
    "api_job_templates_slice_workflow_jobs_create",
    "api_job_templates_survey_spec_list",
    "api_job_templates_survey_spec_create",
    "api_job_templates_survey_spec_delete",
    "api_job_templates_webhook_key_list",
    "api_job_templates_webhook_key_create",
    "api_jobs_list",
    "api_jobs_read",
    "api_jobs_delete",
    "api_jobs_activity_stream_list",
    "api_jobs_cancel_read",
    "api_jobs_cancel_create",
    "api_jobs_create_schedule_read",
    "api_jobs_create_schedule_create",
    "api_jobs_credentials_list",
    "api_jobs_job_events_list",
    "api_jobs_job_events_children_summary_list",
    "api_jobs_job_host_summaries_list",
    "api_jobs_labels_list",
    "api_jobs_notifications_list",
    "api_jobs_relaunch_read",
    "api_jobs_relaunch_create",
    "api_jobs_stdout_read",
    // "api_labels_list",
    // "api_labels_create",
    // "api_labels_read",
    // "api_labels_update",
    // "api_labels_partial_update",
    // "api_me_list",
    // "api_mesh_visualizer_list",
    // "api_metrics_list",
    // "api_notification_templates_list",
    // "api_notification_templates_create",
    // "api_notification_templates_read",
    // "api_notification_templates_update",
    // "api_notification_templates_delete",
    // "api_notification_templates_partial_update",
    // "api_notification_templates_copy_list",
    // "api_notification_templates_copy_create",
    // "api_notification_templates_notifications_list",
    // "api_notification_templates_test_create",
    // "api_notifications_list",
    // "api_notifications_read",
    "api_organizations_list",
    "api_organizations_create",
    "api_organizations_read",
    "api_organizations_update",
    "api_organizations_delete",
    "api_organizations_partial_update",
    "api_organizations_access_list_list",
    "api_organizations_activity_stream_list",
    "api_organizations_admins_list",
    "api_organizations_admins_create",
    "api_organizations_credentials_list",
    "api_organizations_credentials_create",
    "api_organizations_execution_environments_list",
    "api_organizations_execution_environments_create",
    "api_organizations_galaxy_credentials_list",
    "api_organizations_galaxy_credentials_create",
    "api_organizations_instance_groups_list",
    "api_organizations_instance_groups_create",
    "api_organizations_inventories_list",
    "api_organizations_job_templates_list",
    "api_organizations_job_templates_create",
    "api_organizations_notification_templates_list",
    "api_organizations_notification_templates_create",
    "api_organizations_notification_templates_approvals_list",
    "api_organizations_notification_templates_approvals_create",
    "api_organizations_notification_templates_error_list",
    "api_organizations_notification_templates_error_create",
    "api_organizations_notification_templates_started_list",
    "api_organizations_notification_templates_started_create",
    "api_organizations_notification_templates_success_list",
    "api_organizations_notification_templates_success_create",
    "api_organizations_object_roles_list",
    "api_organizations_projects_list",
    "api_organizations_projects_create",
    "api_organizations_teams_list",
    "api_organizations_teams_create",
    "api_organizations_users_list",
    "api_organizations_users_create",
    "api_organizations_workflow_job_templates_list",
    "api_organizations_workflow_job_templates_create",
    // "api_ping_list",
    "api_project_updates_list",
    "api_project_updates_read",
    "api_project_updates_delete",
    "api_project_updates_cancel_read",
    "api_project_updates_cancel_create",
    "api_project_updates_events_list",
    "api_project_updates_notifications_list",
    "api_project_updates_scm_inventory_updates_list",
    "api_project_updates_stdout_read",
    "api_projects_list",
    "api_projects_create",
    "api_projects_read",
    "api_projects_update",
    "api_projects_delete",
    "api_projects_partial_update",
    "api_projects_access_list_list",
    "api_projects_activity_stream_list",
    "api_projects_copy_list",
    "api_projects_copy_create",
    "api_projects_inventories_read",
    "api_projects_notification_templates_error_list",
    "api_projects_notification_templates_error_create",
    "api_projects_notification_templates_started_list",
    "api_projects_notification_templates_started_create",
    "api_projects_notification_templates_success_list",
    "api_projects_notification_templates_success_create",
    "api_projects_object_roles_list",
    "api_projects_playbooks_read",
    "api_projects_project_updates_list",
    "api_projects_schedules_list",
    "api_projects_schedules_create",
    "api_projects_scm_inventory_sources_list",
    "api_projects_teams_list",
    "api_projects_update_read",
    "api_projects_update_create",
    // "api_receptor_addresses_list",
    // "api_receptor_addresses_read",
    "api_v2_role_definitions_list",
    "api_v2_role_definitions_create",
    "api_v2_role_definitions_read",
    "api_v2_role_definitions_update",
    "api_v2_role_definitions_delete",
    "api_v2_role_definitions_partial_update",
    "api_v2_role_definitions_team_assignments_list",
    "api_v2_role_definitions_user_assignments_list",
    "api_v2_role_metadata_list",
    "api_v2_role_team_access_list",
    "api_v2_role_team_access_list_1",
    "api_v2_role_team_assignments_list",
    "api_v2_role_team_assignments_create",
    "api_v2_role_team_assignments_read",
    "api_v2_role_team_assignments_delete",
    "api_v2_role_user_access_list",
    "api_v2_role_user_access_list_1",
    "api_v2_role_user_assignments_list",
    "api_v2_role_user_assignments_create",
    "api_v2_role_user_assignments_read",
    "api_v2_role_user_assignments_delete",
    "api_roles_list",
    "api_roles_read",
    "api_roles_children_list",
    "api_roles_parents_list",
    "api_roles_teams_list",
    "api_roles_teams_create",
    "api_roles_users_list",
    "api_roles_users_create",
    // "api_schedules_list",
    // "api_schedules_create",
    // "api_schedules_preview_create",
    // "api_schedules_zoneinfo_list",
    // "api_schedules_read",
    // "api_schedules_update",
    // "api_schedules_delete",
    // "api_schedules_partial_update",
    // "api_schedules_credentials_list",
    // "api_schedules_credentials_create",
    // "api_schedules_instance_groups_list",
    // "api_schedules_instance_groups_create",
    // "api_schedules_jobs_list",
    // "api_schedules_labels_list",
    // "api_schedules_labels_create",
    // "api_v2_service-index_list",
    // "api_v2_service-index_metadata_list",
    // "api_v2_service-index_object-delete_create",
    // "api_v2_service-index_resource-types_list",
    // "api_v2_service-index_resource-types_read",
    // "api_v2_service-index_resource-types_manifest",
    // "api_v2_service-index_resources_list",
    // "api_v2_service-index_resources_create",
    // "api_v2_service-index_resources_read",
    // "api_v2_service-index_resources_update",
    // "api_v2_service-index_resources_delete",
    // "api_v2_service-index_resources_partial_update",
    // "api_v2_service-index_role-permissions_list",
    // "api_v2_service-index_role-team-assignments_list",
    // "api_v2_service-index_role-team-assignments_assign",
    // "api_v2_service-index_role-team-assignments_unassign",
    // "api_v2_service-index_role-types_list",
    // "api_v2_service-index_role-user-assignments_list",
    // "api_v2_service-index_role-user-assignments_assign",
    // "api_v2_service-index_role-user-assignments_unassign",
    // "api_settings_list",
    // "api_settings_logging_test_create",
    // "api_settings_read",
    // "api_settings_update",
    // "api_settings_delete",
    // "api_settings_partial_update",
    // "api_system_job_templates_list",
    // "api_system_job_templates_read",
    // "api_system_job_templates_jobs_list",
    // "api_system_job_templates_launch_list",
    // "api_system_job_templates_launch_create",
    // "api_system_job_templates_notification_templates_error_list",
    // "api_system_job_templates_notification_templates_error_create",
    // "api_system_job_templates_notification_templates_started_list",
    // "api_system_job_templates_notification_templates_started_create",
    // "api_system_job_templates_notification_templates_success_list",
    // "api_system_job_templates_notification_templates_success_create",
    // "api_system_job_templates_schedules_list",
    // "api_system_job_templates_schedules_create",
    // "api_system_jobs_list",
    // "api_system_jobs_read",
    // "api_system_jobs_delete",
    // "api_system_jobs_cancel_read",
    // "api_system_jobs_cancel_create",
    // "api_system_jobs_events_list",
    // "api_system_jobs_notifications_list",
    "api_teams_list",
    "api_teams_create",
    "api_teams_read",
    "api_teams_update",
    "api_teams_delete",
    "api_teams_partial_update",
    "api_teams_access_list_list",
    "api_teams_activity_stream_list",
    "api_teams_credentials_list",
    "api_teams_credentials_create",
    "api_teams_object_roles_list",
    "api_teams_projects_list",
    "api_teams_roles_list",
    "api_teams_roles_create",
    "api_teams_users_list",
    "api_teams_users_create",
    "api_unified_job_templates_list",
    "api_unified_jobs_list",
    "api_users_list",
    "api_users_create",
    "api_users_read",
    "api_users_update",
    "api_users_delete",
    "api_users_partial_update",
    "api_users_access_list_list",
    "api_users_activity_stream_list",
    "api_users_admin_of_organizations_list",
    "api_users_credentials_list",
    "api_users_credentials_create",
    "api_users_organizations_list",
    "api_users_projects_list",
    "api_users_roles_list",
    "api_users_roles_create",
    "api_users_teams_list",
    // "api_workflow_approval_templates_read",
    // "api_workflow_approval_templates_update",
    // "api_workflow_approval_templates_delete",
    // "api_workflow_approval_templates_partial_update",
    // "api_workflow_approval_templates_approvals_list",
    // "api_workflow_approvals_list",
    // "api_workflow_approvals_read",
    // "api_workflow_approvals_delete",
    // "api_workflow_approvals_approve_read",
    // "api_workflow_approvals_approve_create",
    // "api_workflow_approvals_deny_read",
    // "api_workflow_approvals_deny_create",
    // "api_workflow_job_nodes_list",
    // "api_workflow_job_nodes_read",
    // "api_workflow_job_nodes_always_nodes_list",
    // "api_workflow_job_nodes_credentials_list",
    // "api_workflow_job_nodes_failure_nodes_list",
    // "api_workflow_job_nodes_instance_groups_list",
    // "api_workflow_job_nodes_instance_groups_create",
    // "api_workflow_job_nodes_labels_list",
    // "api_workflow_job_nodes_success_nodes_list",
    // "api_workflow_job_template_nodes_list",
    // "api_workflow_job_template_nodes_create",
    // "api_workflow_job_template_nodes_read",
    // "api_workflow_job_template_nodes_update",
    // "api_workflow_job_template_nodes_delete",
    // "api_workflow_job_template_nodes_partial_update",
    // "api_workflow_job_template_nodes_always_nodes_list",
    // "api_workflow_job_template_nodes_always_nodes_create",
    // "api_workflow_job_template_nodes_create_approval_template_read",
    // "api_workflow_job_template_nodes_create_approval_template_create",
    // "api_workflow_job_template_nodes_credentials_list",
    // "api_workflow_job_template_nodes_credentials_create",
    // "api_workflow_job_template_nodes_failure_nodes_list",
    // "api_workflow_job_template_nodes_failure_nodes_create",
    // "api_workflow_job_template_nodes_instance_groups_list",
    // "api_workflow_job_template_nodes_instance_groups_create",
    // "api_workflow_job_template_nodes_labels_list",
    // "api_workflow_job_template_nodes_labels_create",
    // "api_workflow_job_template_nodes_success_nodes_list",
    // "api_workflow_job_template_nodes_success_nodes_create",
    "api_workflow_job_templates_list",
    "api_workflow_job_templates_create",
    "api_workflow_job_templates_read",
    "api_workflow_job_templates_update",
    "api_workflow_job_templates_delete",
    "api_workflow_job_templates_partial_update",
    "api_workflow_job_templates_access_list_list",
    "api_workflow_job_templates_activity_stream_list",
    "api_workflow_job_templates_bitbucket_dc_create",
    "api_workflow_job_templates_copy_list",
    "api_workflow_job_templates_copy_create",
    "api_workflow_job_templates_github_create",
    "api_workflow_job_templates_gitlab_create",
    "api_workflow_job_templates_labels_list",
    "api_workflow_job_templates_labels_create",
    "api_workflow_job_templates_launch_read",
    "api_workflow_job_templates_launch_create",
    "api_workflow_job_templates_notification_templates_approvals_list",
    "api_workflow_job_templates_notification_templates_approvals_create",
    "api_workflow_job_templates_notification_templates_error_list",
    "api_workflow_job_templates_notification_templates_error_create",
    "api_workflow_job_templates_notification_templates_started_list",
    "api_workflow_job_templates_notification_templates_started_create",
    "api_workflow_job_templates_notification_templates_success_list",
    "api_workflow_job_templates_notification_templates_success_create",
    "api_workflow_job_templates_object_roles_list",
    "api_workflow_job_templates_schedules_list",
    "api_workflow_job_templates_schedules_create",
    "api_workflow_job_templates_survey_spec_list",
    "api_workflow_job_templates_survey_spec_create",
    "api_workflow_job_templates_survey_spec_delete",
    "api_workflow_job_templates_webhook_key_list",
    "api_workflow_job_templates_webhook_key_create",
    "api_workflow_job_templates_workflow_jobs_list",
    "api_workflow_job_templates_workflow_nodes_list",
    "api_workflow_job_templates_workflow_nodes_create",
    "api_workflow_jobs_list",
    "api_workflow_jobs_read",
    "api_workflow_jobs_delete",
    "api_workflow_jobs_activity_stream_list",
    "api_workflow_jobs_cancel_read",
    "api_workflow_jobs_cancel_create",
    "api_workflow_jobs_labels_list",
    "api_workflow_jobs_notifications_list",
    "api_workflow_jobs_relaunch_list",
    "api_workflow_jobs_relaunch_create",
    "api_workflow_jobs_workflow_nodes_list",
    // "api_retrieve",
    // "api_gateway_retrieve",
    // "root_retrieve",
    // "activitystream_list",
    // "activitystream_retrieve",
    // "app_urls_list",
    // "applications_list",
    // "applications_create",
    // "applications_retrieve",
    // "applications_update",
    // "applications_destroy",
    // "applications_partial_update",
    // "applications_tokens_list",
    // "authenticator_maps_list",
    // "authenticator_maps_create",
    // "authenticator_maps_retrieve",
    // "authenticator_maps_update",
    // "authenticator_maps_destroy",
    // "authenticator_maps_partial_update",
    // "authenticator_maps_authenticators_list",
    // "authenticator_maps_authenticators_associate_create",
    // "authenticator_maps_authenticators_disassociate_create",
    // "authenticator_plugins_retrieve",
    // "authenticator_users_list",
    // "authenticator_users_retrieve",
    // "authenticator_users_move_create",
    // "authenticators_list",
    // "authenticators_create",
    // "authenticators_retrieve",
    // "authenticators_update",
    // "authenticators_destroy",
    // "authenticators_partial_update",
    // "authenticators_authenticator_maps_list",
    // "authenticators_users_list",
    // "docs_schema_retrieve",
    // "feature_flags_state_retrieve",
    // "http_ports_list",
    // "http_ports_create",
    // "http_ports_retrieve",
    // "http_ports_update",
    // "http_ports_destroy",
    // "http_ports_partial_update",
    // "http_ports_routes_list",
    // "http_ports_routes_associate_create",
    // "http_ports_routes_disassociate_create",
    // "jwt_key_retrieve",
    // "legacy_auth_list",
    // "legacy_auth_authenticate_sso_retrieve",
    // "legacy_auth_controller_password_retrieve",
    // "legacy_auth_controller_password_create",
    // "legacy_auth_eda_password_retrieve",
    // "legacy_auth_eda_password_create",
    // "legacy_auth_finalize_create",
    // "legacy_auth_hub_password_retrieve",
    // "legacy_auth_hub_password_create",
    // "legacy_auth_reset_create",
    // "me_list",
    "organizations_list",
    "organizations_create",
    "organizations_retrieve",
    "organizations_update",
    "organizations_destroy",
    "organizations_partial_update",
    "organizations_admins_list",
    "organizations_admins_associate_create",
    "organizations_admins_disassociate_create",
    "organizations_teams_list",
    "organizations_users_list",
    "organizations_users_associate_create",
    "organizations_users_disassociate_create",
    "ping_retrieve",
    "role_definitions_list",
    "role_definitions_create",
    "role_definitions_retrieve",
    "role_definitions_update",
    "role_definitions_destroy",
    "role_definitions_partial_update",
    "role_definitions_team_assignments_list",
    "role_definitions_user_assignments_list",
    "role_metadata_retrieve",
    "role_team_assignments_list",
    "role_team_assignments_create",
    "role_team_assignments_retrieve",
    "role_team_assignments_destroy",
    "role_user_assignments_list",
    "role_user_assignments_create",
    "role_user_assignments_retrieve",
    "role_user_assignments_destroy",
    "routes_list",
    "routes_create",
    "routes_retrieve",
    "routes_update",
    "routes_destroy",
    "routes_partial_update",
    "service_index_retrieve",
    "service_index_metadata_retrieve",
    "service_index_resource_types_list",
    "service_index_resource_types_retrieve",
    "service_index_resource_types_manifest_retrieve",
    "service_index_resources_list",
    "service_index_resources_create",
    "service_index_resources_retrieve",
    "service_index_resources_update",
    "service_index_resources_destroy",
    "service_index_resources_partial_update",
    "service_index_validate_local_account_create",
    "service_clusters_list",
    "service_clusters_create",
    "service_clusters_retrieve",
    "service_clusters_update",
    "service_clusters_destroy",
    "service_clusters_partial_update",
    "service_clusters_nodes_list",
    "service_clusters_routes_list",
    "service_clusters_routes_associate_create",
    "service_clusters_routes_disassociate_create",
    "service_clusters_service_keys_list",
    "service_clusters_service_types_list",
    "service_clusters_service_types_associate_create",
    "service_clusters_service_types_disassociate_create",
    "service_keys_list",
    "service_keys_create",
    "service_keys_retrieve",
    "service_keys_update",
    "service_keys_destroy",
    "service_keys_partial_update",
    "service_nodes_list",
    "service_nodes_create",
    "service_nodes_retrieve",
    "service_nodes_update",
    "service_nodes_destroy",
    "service_nodes_partial_update",
    "service_types_list",
    "service_types_create",
    "service_types_retrieve",
    "service_types_update",
    "service_types_destroy",
    "service_types_partial_update",
    "service_types_clusters_list",
    "services_list",
    "services_create",
    "services_retrieve",
    "services_update",
    "services_destroy",
    "services_partial_update",
    // "session_retrieve",
    // "session_create",
    // "settings_list",
    // "settings_getter",
    // "settings_update",
    // "settings_destroyer",
    // "settings_retrieve",
    // "settings_destroy",
    // "status_retrieve",
    "teams_list",
    "teams_create",
    "teams_retrieve",
    "teams_update",
    "teams_destroy",
    "teams_partial_update",
    "teams_admins_list",
    "teams_admins_associate_create",
    "teams_admins_disassociate_create",
    "teams_users_list",
    "teams_users_associate_create",
    "teams_users_disassociate_create",
    // "tokens_list",
    // "tokens_create",
    // "tokens_retrieve",
    // "tokens_update",
    // "tokens_destroy",
    // "tokens_partial_update",
    // "trigger_definition_retrieve",
    // "ui_auth_retrieve",
    "users_list",
    "users_create",
    "users_retrieve",
    "users_update",
    "users_destroy",
    "users_partial_update",
    "users_authenticators_retrieve",
    "users_authorized_tokens_retrieve",
    "users_organizations_list",
    "users_personal_tokens_retrieve",
    "users_teams_list",
    // "users_tokens_retrieve",
    // "o_retrieve",
  ];

  // Calculate size for each tool and sort by size
  const toolsWithSize = rawToolList.map(tool => {
    const toolSize = JSON.stringify({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }).length;
    return {
      ...tool,
      size: toolSize
    };
  });

  // Sort by size in descending order
  toolsWithSize.sort((a, b) => b.size - a.size);

  console.log("=== LARGEST TOOLS ===");
  console.log(`Tool name,size (characters)`);
  toolsWithSize.forEach((tool, index) => {
    console.log(`${tool.name},${tool.size}`);
  });
  console.log("=== END OF LARGEST TOOLS ===");

  const filteredTools = toolsWithSize.filter(tool =>
    allowList.some(allowed => tool.name == allowed)
  );

  const fullSize = toolsWithSize.reduce((accumulator, currentValue) => accumulator + currentValue.size, 0);
  const loadedSize = filteredTools.reduce((accumulator, currentValue) => accumulator + currentValue.size, 0);

  console.log(`Tool number=${filteredTools.length} loadedSize=${loadedSize}, fullSize=${fullSize} characters`);
  return filteredTools;
};

let allTools: any[] = [];

const server = new Server(
  {
    name: "poc-aap-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: allTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args = {} } = request.params;

  // Find the matching tool
  const tool = allTools.find(t => t.name === name);
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }

  // Get the session ID from the transport context
  const transport = extra?.transport as StreamableHTTPServerTransport;
  const sessionId = transport?.sessionId;

  // Get the Bearer token for this session
  let bearerToken = process.env.BEARER_TOKEN_OAUTH2_AUTHENTICATION; // fallback to env var
  if (sessionId && sessionTokens[sessionId]) {
    bearerToken = sessionTokens[sessionId];
    console.log(`Using session-specific Bearer token for session: ${sessionId}`);
  } else {
    console.log('Using fallback Bearer token from environment variable');
  }

  // Execute the tool by making HTTP request
  try {
    // Build URL from path template and parameters
    let url = tool.pathTemplate;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${bearerToken}`,
      'Accept': 'application/json'
    };

    for (const param of tool.parameters || []) {
      console.log(param.name);
      if (param.in === 'path' && args[param.name]) {
        url = url.replace(`{${param.name}}`, String(args[param.name]));
      }
    }

    // Add query parameters
    const queryParams = new URLSearchParams();
    for (const param of tool.parameters || []) {
      if (param.in === 'query' && args[param.name] !== undefined) {
        queryParams.append(param.name, String(args[param.name]));
      }
    }
    if (queryParams.toString()) {
      url += '?' + queryParams.toString();
    }

    // Prepare request options
    const requestOptions: RequestInit = {
      method: tool.method.toUpperCase(),
      headers
    };

    // Add request body for POST, PUT, PATCH
    if (['POST', 'PUT', 'PATCH'].includes(tool.method.toUpperCase()) && args.requestBody) {
      headers['Content-Type'] = 'application/json';
      requestOptions.body = JSON.stringify(args.requestBody);
    }

    // Make HTTP request
    console.log(`Calling: http://localhost:44926${url}`);
    const response = await fetch(`http://localhost:44926${url}`, requestOptions);
    console.log(response);

    let result;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      result = await response.json();
    } else {
      result = await response.text();
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${JSON.stringify(result)}`);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    throw new Error(`Tool execution failed: ${error instanceof Error ? error.message : String(error)}`);
  }
});

// Map to store transports by session ID
const transports: Record<string, StreamableHTTPServerTransport> = {};

const MCP_PORT = process.env.MCP_PORT ? parseInt(process.env.MCP_PORT, 10) : 3000;

const app = express();
app.use(express.json());

// Allow CORS for all domains, expose the Mcp-Session-Id header
app.use(cors({
  origin: '*',
  exposedHeaders: ["Mcp-Session-Id"]
}));

// Map to store Bearer tokens by session ID
const sessionTokens: Record<string, string> = {};

// MCP POST endpoint handler
const mcpPostHandler = async (req: express.Request, res: express.Response) => {
  const sessionId = req.headers['mcp-session-id'] as string;
  const authHeader = req.headers['authorization'] as string;

  if (sessionId) {
    console.log(`Received MCP request for session: ${sessionId}`);
    // Store the Bearer token for this session if provided
    if (authHeader && authHeader.startsWith('Bearer ')) {
      sessionTokens[sessionId] = authHeader.substring(7); // Remove "Bearer " prefix
      console.log(`Updated Bearer token for session: ${sessionId}`);
    }
  } else {
    console.log('Request body:', req.body);
    // For initialization requests, we'll store the token when session is created
  }

  try {
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      // Reuse existing transport
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New initialization request
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId: string) => {
          console.log(`Session initialized with ID: ${sessionId}`);
          transports[sessionId] = transport;
          // Store the Bearer token for this new session if provided
          if (authHeader && authHeader.startsWith('Bearer ')) {
            sessionTokens[sessionId] = authHeader.substring(7); // Remove "Bearer " prefix
            console.log(`Stored Bearer token for new session: ${sessionId}`);
          }
        }
      });

      // Set up onclose handler to clean up transport when closed
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) {
          console.log(`Transport closed for session ${sid}, removing from transports map`);
          delete transports[sid];
          // Also clean up the session token
          if (sessionTokens[sid]) {
            delete sessionTokens[sid];
            console.log(`Removed Bearer token for session: ${sid}`);
          }
        }
      };

      // Connect the transport to the MCP server BEFORE handling the request
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    } else {
      // Invalid request - no session ID or not initialization request
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: null,
      });
      return;
    }

    // Handle the request with existing transport
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
};

// MCP GET endpoint for SSE streams
const mcpGetHandler = async (req: express.Request, res: express.Response) => {
  const sessionId = req.headers['mcp-session-id'] as string;
  const authHeader = req.headers['authorization'] as string;

  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  // Update Bearer token for this session if provided
  if (authHeader && authHeader.startsWith('Bearer ')) {
    sessionTokens[sessionId] = authHeader.substring(7); // Remove "Bearer " prefix
    console.log(`Updated Bearer token for session: ${sessionId}`);
  }

  const lastEventId = req.headers['last-event-id'];
  if (lastEventId) {
    console.log(`Client reconnecting with Last-Event-ID: ${lastEventId}`);
  } else {
    console.log(`Establishing new SSE stream for session ${sessionId}`);
  }

  const transport = transports[sessionId];
  await transport.handleRequest(req, res);
};

// MCP DELETE endpoint for session termination
const mcpDeleteHandler = async (req: express.Request, res: express.Response) => {
  const sessionId = req.headers['mcp-session-id'] as string;

  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  console.log(`Received session termination request for session ${sessionId}`);

  try {
    const transport = transports[sessionId];
    await transport.handleRequest(req, res);

    // Clean up the session token when session is terminated
    if (sessionTokens[sessionId]) {
      delete sessionTokens[sessionId];
      console.log(`Removed Bearer token for terminated session: ${sessionId}`);
    }
  } catch (error) {
    console.error('Error handling session termination:', error);
    if (!res.headersSent) {
      res.status(500).send('Error processing session termination');
    }
  }
};

// Set up routes
app.post('/mcp', mcpPostHandler);
app.get('/mcp', mcpGetHandler);
app.delete('/mcp', mcpDeleteHandler);

async function main() {
  // Initialize tools before starting server
  allTools = await generateTools();
  console.log(`Loaded ${allTools.length} tools from OpenAPI specifications`);

  // Start HTTP server
  app.listen(MCP_PORT, (error?: Error) => {
    if (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
    console.log(`MCP Streamable HTTP Server listening on port ${MCP_PORT}`);
  });
}

// Handle server shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');

  // Close all active transports to properly clean up resources
  for (const sessionId in transports) {
    try {
      console.log(`Closing transport for session ${sessionId}`);
      await transports[sessionId].close();
      delete transports[sessionId];
    } catch (error) {
      console.error(`Error closing transport for session ${sessionId}:`, error);
    }
  }

  console.log('Server shutdown complete');
  process.exit(0);
});

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
