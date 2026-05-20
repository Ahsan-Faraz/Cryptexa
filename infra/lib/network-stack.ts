/* eslint-disable */
import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ssm from "aws-cdk-lib/aws-ssm";

interface NetworkStackProps extends StackProps {
  appPort?: number;
}

export class NetworkStack extends Stack {
  constructor(scope: Construct, id: string, props: NetworkStackProps = {}) {
    super(scope, id, props);

    const appPort = props.appPort ?? 3000;

    // NAT Gateway is intentionally omitted to avoid always-paid charges
    const vpc = new ec2.Vpc(this, "CryptoPulseVpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: "private",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });

    // Security Groups
    const albSg = new ec2.SecurityGroup(this, "ALBSecurityGroup", {
      vpc,
      description: "ALB ingress from internet, egress to ECS tasks",
      allowAllOutbound: false,
    });

    const ecsSg = new ec2.SecurityGroup(this, "ECSSecurityGroup", {
      vpc,
      description: "ECS tasks accept traffic only from ALB",
      allowAllOutbound: false,
    });

    const lambdaSg = new ec2.SecurityGroup(this, "LambdaSecurityGroup", {
      vpc,
      description: "Lambda egress to HTTPS only",
      allowAllOutbound: false,
    });

    const rdsSg = new ec2.SecurityGroup(this, "RDSSecurityGroup", {
      vpc,
      description: "RDS accepts traffic only from ECS tasks",
      allowAllOutbound: false,
    });

    // ALB rules
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "HTTP from internet");
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS from internet");
    albSg.addEgressRule(ecsSg, ec2.Port.tcp(appPort), "Forward traffic to ECS tasks");

    // ECS rules
    ecsSg.addIngressRule(albSg, ec2.Port.tcp(appPort), "Only ALB can reach ECS");
    ecsSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS outbound for API calls");

    // Lambda rules
    lambdaSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS outbound for API calls");

    // RDS rules
    rdsSg.addIngressRule(ecsSg, ec2.Port.tcp(5432), "Postgres from ECS only");

    // IAM Roles
    const ecsTaskExecutionRole = new iam.Role(this, "ECSTaskExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    ecsTaskExecutionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy")
    );

    const ecsTaskRole = new iam.Role(this, "ECSTaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    ecsTaskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
        resources: ["*"],
      })
    );
    ecsTaskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
        resources: ["*"],
      })
    );

    const lambdaExecutionRole = new iam.Role(this, "LambdaExecutionRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    lambdaExecutionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")
    );
    lambdaExecutionRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
        resources: ["*"],
      })
    );
    lambdaExecutionRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:Query",
          "dynamodb:Scan",
        ],
        resources: ["*"],
      })
    );

    // SSM Parameters
    new ssm.StringParameter(this, "VpcIdParam", {
      parameterName: "/cryptopulse/vpc-id",
      stringValue: vpc.vpcId,
    });

    new ssm.StringParameter(this, "PublicSubnetIdsParam", {
      parameterName: "/cryptopulse/public-subnet-ids",
      stringValue: vpc.publicSubnets.map(s => s.subnetId).join(","),
    });

    new ssm.StringParameter(this, "PrivateSubnetIdsParam", {
      parameterName: "/cryptopulse/private-subnet-ids",
      stringValue: vpc.isolatedSubnets.map(s => s.subnetId).join(","),
    });

    new ssm.StringParameter(this, "EcsSgIdParam", {
      parameterName: "/cryptopulse/ecs-sg-id",
      stringValue: ecsSg.securityGroupId,
    });

    new ssm.StringParameter(this, "AlbSgIdParam", {
      parameterName: "/cryptopulse/alb-sg-id",
      stringValue: albSg.securityGroupId,
    });
  }
}