"use client";
import React, { useState } from "react";
import {
  Alert,
  AutoComplete,
  Checkbox,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import { catalog } from "@subtitle/providers/catalog";
import type { PublicProfile } from "@subtitle/core";
import { errorText, type Command } from "./shared";

export function ProfileDialog({
  profile,
  close,
  command,
}: {
  profile?: PublicProfile;
  close: () => void;
  command: Command;
}) {
  const [form] = Form.useForm();
  const [provider, setProvider] = useState(profile?.provider || "openai");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const definition = catalog.find((p) => p.id === provider)!;
  return (
    <Modal
      open
      title={profile ? "编辑配置" : "添加模型或存储"}
      width={600}
      onCancel={() => !saving && close()}
      onOk={() => form.submit()}
      confirmLoading={saving}
      okText="保存配置"
      cancelButtonProps={{ disabled: saving }}
      maskClosable={!saving}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          name: profile?.name,
          provider,
          model: profile?.model || "whisper-1",
          options: profile?.options || {},
          secrets: {},
          allowPrivateEndpoint: profile?.allowPrivateEndpoint || false,
        }}
        onFinish={async (values) => {
          setSaving(true);
          setError("");
          try {
            const options: Record<string, string> = {},
              secrets: Record<string, string> = {};
            for (const field of definition.fields)
              (field.secret ? secrets : options)[field.key] = String(
                (field.secret ? values.secrets : values.options)?.[field.key] ||
                  "",
              );
            await command("profile.save", {
              id: profile?.id,
              name: values.name.trim(),
              provider,
              model: values.model || "",
              options,
              secrets,
              allowPrivateEndpoint: !!values.allowPrivateEndpoint,
            });
            close();
          } catch (e) {
            setError(errorText(e));
          } finally {
            setSaving(false);
          }
        }}
      >
        {error && (
          <Alert className="wb-gap" showIcon type="error" title={error} />
        )}
        <Form.Item
          name="name"
          label="配置名称"
          rules={[{ required: true, whitespace: true }, { max: 120 }]}
        >
          <Input placeholder="例如：我的中文识别" />
        </Form.Item>
        <Form.Item name="provider" label="服务商" rules={[{ required: true }]}>
          <Select
            showSearch
            optionFilterProp="label"
            disabled={!!profile}
            options={(
              [
                ["asr", "语音识别"],
                ["translation", "字幕翻译"],
                ["storage", "音频临时存储"],
              ] as const
            ).map(([category, label]) => ({
              label,
              options: catalog
                .filter((p) => p.category === category)
                .map((p) => ({ value: p.id, label: p.name })),
            }))}
            onChange={(value) => {
              form.resetFields(["model", "options", "secrets"]);
              form.setFieldsValue({
                model: catalog.find((p) => p.id === value)?.models[0] || "",
                options: {},
                secrets: {},
              });
              setProvider(value);
              setError("");
            }}
          />
        </Form.Item>
        <Form.Item
          name="model"
          label="模型 / 接口模式"
          rules={[
            { required: definition.category !== "storage" },
            { max: 200 },
          ]}
        >
          <AutoComplete
            options={definition.models.map((model) => ({ value: model }))}
            placeholder="选择或输入模型名称"
            filterOption={(input, option) =>
              !!option?.value.toLowerCase().includes(input.toLowerCase())
            }
          />
        </Form.Item>
        <Space wrap className="wb-gap">
          {definition.input && <Tag>输入：{definition.input}</Tag>}
          {definition.timestamps && <Tag>时间戳：{definition.timestamps}</Tag>}
          {definition.maxChunkSeconds && (
            <Tag>分片上限：{definition.maxChunkSeconds} 秒</Tag>
          )}
        </Space>
        {definition.fields.map((field) => (
          <Form.Item
            key={`${provider}:${field.key}`}
            preserve={false}
            name={[field.secret ? "secrets" : "options", field.key]}
            label={field.label}
            extra={
              field.secret && profile?.secretFields.includes(field.key)
                ? "已加密保存，留空保持不变"
                : undefined
            }
            rules={[
              {
                required:
                  !field.optional &&
                  !(field.secret && profile?.secretFields.includes(field.key)),
                whitespace: true,
              },
            ]}
          >
            {field.key === "serviceAccount" ? (
              <Input.TextArea
                rows={4}
                autoComplete="off"
                placeholder="粘贴 Service Account JSON"
              />
            ) : field.secret ? (
              <Input.Password
                autoComplete="new-password"
                placeholder={field.placeholder}
              />
            ) : (
              <Input placeholder={field.placeholder} />
            )}
          </Form.Item>
        ))}
        {definition.note && (
          <Alert
            className="wb-gap"
            showIcon
            type="info"
            title={definition.note}
          />
        )}
        <Form.Item name="allowPrivateEndpoint" valuePropName="checked">
          <Checkbox>
            允许访问内网 / HTTP 地址（仅用于信任的自定义服务）
          </Checkbox>
        </Form.Item>
        <Typography.Text type="secondary">
          保存配置不代表真实账号联调通过。
        </Typography.Text>{" "}
        {definition.docs && (
          <Typography.Link
            href={definition.docs}
            target="_blank"
            rel="noreferrer"
          >
            官方接口文档
          </Typography.Link>
        )}
      </Form>
    </Modal>
  );
}
