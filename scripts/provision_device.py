#!/usr/bin/env python3
"""Register a Pi with AWS IoT Core and generate device certificates."""
import boto3, json, os, sys

def provision(gate_id: str, community_id: str):
    iot = boto3.client("iot", region_name="ap-south-1")
    thing = f"gate-{community_id[:8]}-{gate_id}"

    iot.create_thing(thingName=thing,
        attributePayload={"attributes":{"gate_id":gate_id,"community_id":community_id}})
    cert = iot.create_keys_and_certificate(setAsActive=True)
    arn  = cert["certificateArn"]
    iot.attach_policy(policyName="CommunityGateEdgePolicy", target=arn)
    iot.attach_thing_principal(thingName=thing, principal=arn)

    os.makedirs("/certs", exist_ok=True)
    with open("/certs/device.pem","w") as f: f.write(cert["certificatePem"])
    with open("/certs/device.key","w") as f: f.write(cert["keyPair"]["PrivateKey"])
    ep = iot.describe_endpoint(endpointType="iot:Data-ATS")["endpointAddress"]

    print(f"Thing:    {thing}")
    print(f"Cert ARN: {arn}")
    print(f"\nAdd to /etc/communitygate/env:")
    print(f"MQTT_BROKER={ep}")
    print(f"MQTT_PORT=8883")
    print(f"MQTT_USE_TLS=true")
    print(f"MQTT_CERT_PATH=/certs/device.pem")
    print(f"MQTT_KEY_PATH=/certs/device.key")
    print(f"MQTT_CA_PATH=/certs/AmazonRootCA1.pem")
    print(f"GATE_ID={gate_id}")
    print(f"COMMUNITY_ID={community_id}")

if __name__ == "__main__":
    provision(sys.argv[1], sys.argv[2])
    # Usage: python provision_device.py gate-01 <community-uuid>
