#!/usr/bin/env python3
"""根据 FSRS-6 遗忘曲线计算可提取性或连续天数间隔。"""

import argparse
import json
import math


def finite_number(value):
    number = float(value)
    if not math.isfinite(number):
        raise argparse.ArgumentTypeError("FSRS-6 参数必须是有限数")
    return number


def positive_number(value):
    number = finite_number(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("FSRS-6 参数必须大于 0")
    return number


def elapsed_days(value):
    number = finite_number(value)
    if number < 0:
        raise argparse.ArgumentTypeError("FSRS-6 经过天数不能为负数")
    return number


def desired_retention(value):
    number = finite_number(value)
    if not 0 < number <= 1:
        raise argparse.ArgumentTypeError("FSRS-6 目标保持率必须大于 0 且不超过 1")
    return number


def curve_factor(w20):
    # 0.9 来自稳定性 S 的定义：经过 S 天后，可提取性为 90%。
    return math.expm1(-math.log(0.9) / w20)


def retrievability(stability_days, elapsed, w20):
    return math.exp(
        -w20 * math.log1p(curve_factor(w20) * (elapsed / stability_days))
    )


def interval_days(stability_days, retention, w20):
    return stability_days * (
        math.expm1(-math.log(retention) / w20) / curve_factor(w20)
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--stability-days", required=True, type=positive_number,
                        help="对象的稳定性 S，单位为天")
    common.add_argument("--w20", required=True, type=positive_number,
                        help="FSRS-6 模型的正衰减参数 w20")
    commands = parser.add_subparsers(dest="command", required=True)
    probability = commands.add_parser(
        "retrievability", parents=[common], help="计算给定时点的可提取性"
    )
    probability.add_argument("--elapsed-days", required=True, type=elapsed_days,
                             help="从记忆状态基准时点经过的天数")
    interval = commands.add_parser(
        "interval", parents=[common], help="计算达到目标保持率的连续天数"
    )
    interval.add_argument("--desired-retention", required=True, type=desired_retention,
                          help="目标保持率 r")
    args = parser.parse_args()

    try:
        if args.command == "retrievability":
            key = "retrievability"
            result = retrievability(args.stability_days, args.elapsed_days, args.w20)
        else:
            key = "interval_days"
            result = interval_days(args.stability_days, args.desired_retention, args.w20)
        if not math.isfinite(result):
            raise OverflowError("结果超过浮点数的可表示范围")
    except (OverflowError, ZeroDivisionError, ValueError) as error:
        parser.error(f"FSRS-6 数值计算失败：{error}")

    print(json.dumps({key: result}, allow_nan=False))


if __name__ == "__main__":
    main()
