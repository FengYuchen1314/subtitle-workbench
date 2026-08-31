"use client";
import React from "react";
import {
  App,
  Button,
  Card,
  Progress,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import type { AppState, Gateway, Job, JobStatus } from "@subtitle/core";
import { quiet, type Command } from "./shared";
const status: Record<JobStatus, [string, string]> = {
  queued: ["排队中", "default"],
  running: ["处理中", "processing"],
  completed: ["已完成", "success"],
  failed: ["失败", "error"],
  cancelled: ["已取消", "default"],
  attention: ["待确认", "warning"],
};
const kinds = {
  transcribe: "生成原文字幕",
  translate: "翻译字幕",
  render: "烧录字幕视频",
};
export function Jobs({
  state,
  gateway,
  command,
  busy,
  openProject,
}: {
  state: AppState;
  gateway: Gateway;
  command: Command;
  busy: boolean;
  openProject: (id: string) => void;
}) {
  const { modal } = App.useApp();
  return (
    <>
      <div className="wb-page-heading">
        <Typography.Title level={3}>任务队列</Typography.Title>
        <Typography.Text type="secondary">
          自动刷新 · 每个任务独立保存进度
        </Typography.Text>
      </div>
      <Card>
        <Table<Job>
          rowKey="id"
          dataSource={state.jobs}
          scroll={{ x: 1050 }}
          pagination={{ pageSize: 10 }}
          columns={[
            {
              title: "项目 / 任务",
              width: 220,
              render: (_, j) => (
                <Space orientation="vertical" size={0}>
                  <Button type="link" onClick={() => openProject(j.projectId)}>
                    {state.projects.find((p) => p.id === j.projectId)?.name ||
                      "项目"}
                  </Button>
                  <Typography.Text>{kinds[j.kind]}</Typography.Text>
                </Space>
              ),
            },
            {
              title: "状态",
              width: 100,
              render: (_, j) => (
                <Tag color={status[j.status][1]}>{status[j.status][0]}</Tag>
              ),
            },
            {
              title: "进度",
              width: 280,
              render: (_, j) => (
                <>
                  <Progress
                    percent={Math.round(j.progress)}
                    status={
                      j.status === "failed"
                        ? "exception"
                        : j.status === "completed"
                          ? "success"
                          : "normal"
                    }
                    size="small"
                  />
                  <Typography.Text type="secondary">{j.phase}</Typography.Text>
                  {j.error && (
                    <div className="wb-job-error">
                      <Typography.Text type="danger">{j.error}</Typography.Text>
                    </div>
                  )}
                </>
              ),
            },
            {
              title: "创建时间",
              width: 180,
              render: (_, j) => new Date(j.createdAt).toLocaleString("zh-CN"),
            },
            {
              title: "操作",
              width: 270,
              render: (_, j) => (
                <Space wrap>
                  {["queued", "running"].includes(j.status) && (
                    <Button
                      disabled={busy}
                      onClick={() => quiet(command("job.cancel", { id: j.id }))}
                    >
                      取消任务
                    </Button>
                  )}
                  {["attention", "failed", "cancelled"].includes(j.status) && (
                    <>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          quiet(
                            command("job.retry", {
                              id: j.id,
                              confirmPaidRetry: false,
                            }),
                          )
                        }
                      >
                        从断点恢复
                      </Button>
                      {j.kind !== "render" && (
                        <>
                          <Button
                            danger
                            disabled={busy}
                            onClick={() =>
                              modal.confirm({
                                title: "确认重新提交未知请求？",
                                content:
                                  "仅在已检查厂商订单后使用。上次请求可能已扣费，再次提交可能重复计费。普通恢复会保留远端任务 ID，不会重复提交未知请求。",
                                okText: "确认可能重复计费并重试",
                                okButtonProps: { danger: true },
                                onOk: () =>
                                  command("job.retry", {
                                    id: j.id,
                                    confirmPaidRetry: true,
                                  }),
                              })
                            }
                          >
                            重新提交…
                          </Button>
                          <Button
                            disabled={busy}
                            onClick={() =>
                              modal.confirm({
                                title: "用任务结果覆盖当前字幕？",
                                content:
                                  "仅适用于任务已保存但尚未应用的结果。当前手工编辑将被替换。",
                                onOk: () => command("job.apply", { id: j.id }),
                              })
                            }
                          >
                            应用结果…
                          </Button>
                        </>
                      )}
                    </>
                  )}
                  {j.status === "completed" &&
                    (j.outputName ? (
                      <Button
                        type="primary"
                        icon={<DownloadOutlined />}
                        href={
                          gateway.platform === "web"
                            ? gateway.outputUrl(j.id)
                            : undefined
                        }
                        download
                        disabled={busy}
                        onClick={
                          gateway.platform === "web"
                            ? undefined
                            : () => quiet(command("output.save", { id: j.id }))
                        }
                      >
                        保存视频
                      </Button>
                    ) : (
                      <Button onClick={() => openProject(j.projectId)}>
                        查看字幕
                      </Button>
                    ))}
                </Space>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}
